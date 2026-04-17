# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Notebook-specific helpers for whole-notebook linting with cross-cell context.

Provides:
* :class:`SyntheticDocument` — a typed stand-in for ``TextDocument`` used
  when linting a combined notebook source.
* :func:`build_notebook_source` — concatenates all code cells into one
  string, replacing IPython magic lines with ``pass``.
* :func:`remap_diagnostics_to_cells` — maps combined-source diagnostics
  back to individual cell URIs.
* :data:`NOTEBOOK_SYNC_OPTIONS` — default ``NotebookDocumentSyncOptions``
  shared by all tool extensions.

This module is identical across flake8, isort, and pylint (black uses a
simpler variant).
"""

from __future__ import annotations

import dataclasses
import re
from collections.abc import Callable, Sequence
from typing import Any, Protocol

import lsprotocol.types as lsp

# ---------------------------------------------------------------------------
# Protocols & types
# ---------------------------------------------------------------------------


class TextDocumentLike(Protocol):
    """Protocol for objects that provide text document attributes.

    Any object with ``source`` and ``language_id`` string attributes
    satisfies this — including ``pygls.workspace.TextDocument``.
    """

    source: str
    language_id: str


class CellLike(Protocol):
    """Protocol for notebook cell objects.

    Any object with ``kind`` and ``document`` attributes satisfies this —
    including ``lsprotocol.types.NotebookCell``.
    """

    kind: Any
    document: str | None


@dataclasses.dataclass
class SyntheticDocument:
    """Typed stand-in for ``workspace.TextDocument`` used in notebook linting.

    Replaces ``types.SimpleNamespace`` so that the synthetic document has
    an explicit, portable shape that can be type-checked.
    """

    uri: str
    path: str
    source: str
    language_id: str = "python"
    version: int = 0


# Matches IPython magic lines (%, %%, !, !!) so they can be replaced with ``pass``.
MAGIC_LINE_RE = re.compile(r"^\s*(?:%%\w|%(?!=)\w|!!|!(?!=)\w)")

NOTEBOOK_SYNC_OPTIONS = lsp.NotebookDocumentSyncOptions(
    notebook_selector=[
        lsp.NotebookDocumentFilterWithNotebook(
            notebook="jupyter-notebook",
            cells=[
                lsp.NotebookCellLanguage(language="python"),
            ],
        ),
        lsp.NotebookDocumentFilterWithNotebook(
            notebook="interactive",
            cells=[
                lsp.NotebookCellLanguage(language="python"),
            ],
        ),
    ],
    save=True,
)


@dataclasses.dataclass
class CellOffset:
    """Describes where a single notebook cell's lines begin in the combined source."""

    cell_uri: str
    start_line: int
    line_count: int


def build_notebook_source(
    cells: Sequence[CellLike],
    get_text_document: Callable[[str], TextDocumentLike | None],
    *,
    sanitize_line: Callable[[str], str] | None = None,
) -> tuple[str, list[CellOffset]]:
    """Build a single Python source string from all code cells.

    Parameters
    ----------
    cells:
        The notebook's cell list (``nb.cells``).
    get_text_document:
        A callable that resolves a cell document URI to a text document
        object (with ``.source`` and ``.language_id`` attributes).
    sanitize_line:
        Optional per-line transformation.  When *None* the default
        behaviour replaces IPython magic lines with ``pass\\n``.  Pass a
        custom callable to override (e.g. for tool-specific magic handling).

    Returns
    -------
    (combined_source, cell_map) where *cell_map* is a list of
    :class:`CellOffset` instances describing where each cell's lines
    begin in the combined source.
    """
    _sanitize = sanitize_line or _default_sanitize_line

    source_parts: list[str] = []
    cell_map: list[CellOffset] = []
    current_line = 0

    for cell in cells:
        if cell.kind != lsp.NotebookCellKind.Code or cell.document is None:
            continue
        doc = get_text_document(cell.document)
        if doc is None or doc.language_id != "python":
            continue

        source = doc.source
        if not source:
            continue

        lines = source.splitlines(keepends=True)
        # Ensure the last line ends with a newline.
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"

        sanitized_lines = [_sanitize(line) for line in lines]

        cell_map.append(CellOffset(cell.document, current_line, len(sanitized_lines)))
        source_parts.extend(sanitized_lines)
        current_line += len(sanitized_lines)

    return "".join(source_parts), cell_map


def _default_sanitize_line(line: str) -> str:
    """Replace IPython magic lines with ``pass`` while preserving line endings."""
    if not MAGIC_LINE_RE.match(line):
        return line
    if line.endswith("\r\n"):
        return "pass\r\n"
    if line.endswith("\n"):
        return "pass\n"
    return "pass"


def get_cell_for_line(
    global_line: int, cell_map: list[CellOffset]
) -> CellOffset | None:
    """Return the :class:`CellOffset` entry that owns *global_line*.

    *global_line* is a 0-based line number in the combined notebook source.
    Returns ``None`` if no cell owns the line.
    """
    for entry in cell_map:
        if entry.start_line <= global_line < entry.start_line + entry.line_count:
            return entry
    return None


def remap_diagnostics_to_cells(
    diagnostics: Sequence[lsp.Diagnostic],
    cell_map: list[CellOffset],
) -> dict[str, list[lsp.Diagnostic]]:
    """Map combined-source diagnostics back to individual cell URIs.

    Each diagnostic's line range is adjusted relative to the owning cell.
    Diagnostics whose start line doesn't fall in any cell are discarded.
    If a diagnostic's end line crosses a cell boundary it is clamped.
    """
    per_cell: dict[str, list[lsp.Diagnostic]] = {
        entry.cell_uri: [] for entry in cell_map
    }

    for diag in diagnostics:
        entry = get_cell_for_line(diag.range.start.line, cell_map)
        if entry is None:
            continue

        local_start_line = diag.range.start.line - entry.start_line
        local_start = lsp.Position(
            line=local_start_line,
            character=diag.range.start.character,
        )

        # Clamp end line to the cell boundary (defensive).
        max_end_line = entry.line_count - 1
        raw_end_line = diag.range.end.line - entry.start_line
        clamped = raw_end_line > max_end_line
        local_end_line = min(raw_end_line, max_end_line)
        # Use max LSP uint32 value to cover the full last line.
        _MAX_CHARACTER = 2_147_483_647
        local_end = lsp.Position(
            line=local_end_line,
            character=_MAX_CHARACTER if clamped else diag.range.end.character,
        )

        # Ensure end is not before start (inverted range violates LSP spec).
        if (
            local_end.line == local_start.line
            and local_end.character < local_start.character
        ):
            local_end = lsp.Position(
                line=local_start.line, character=local_start.character
            )

        remapped = lsp.Diagnostic(
            range=lsp.Range(start=local_start, end=local_end),
            message=diag.message,
            severity=diag.severity,
            code=diag.code,
            code_description=diag.code_description,
            source=diag.source,
            related_information=diag.related_information,
            tags=diag.tags,
            data=diag.data,
        )
        per_cell[entry.cell_uri].append(remapped)

    return per_cell
