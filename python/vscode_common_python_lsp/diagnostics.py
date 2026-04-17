# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Diagnostic construction and parsing helpers for LSP tool extensions.

Provides:
* Severity resolution shared by flake8, isort, mypy and pylint.
* A generic regex-based diagnostic parser used by flake8 and mypy (with
  a file-aware callback to support mypy's multi-file output).
* A helper to build individual :class:`lsprotocol.types.Diagnostic` objects.
"""

from __future__ import annotations

import dataclasses
import re
from collections.abc import Callable
from typing import Any

import lsprotocol.types as lsp

# ---------------------------------------------------------------------------
# Severity resolution
# ---------------------------------------------------------------------------

# Default severity maps used across repos (tools override via settings).
DEFAULT_SEVERITY: dict[str, str] = {}


def get_severity(
    code: str,
    code_type: str,
    severity_map: dict[str, str],
    *,
    default: str = "Error",
    symbol: str | None = None,
) -> lsp.DiagnosticSeverity:
    """Resolve an LSP :class:`DiagnosticSeverity` from tool output.

    Lookup order (matching pylint's most-expressive pattern):
    ``symbol`` → ``code`` → ``code_type`` → *default*.

    Parameters
    ----------
    code:
        Machine-readable error code (e.g. ``"E501"``, ``"C0301"``).
    code_type:
        Category/type string (e.g. ``"Error"``, ``"convention"``).
    severity_map:
        User-configurable mapping of codes/types → severity names.
    default:
        Fallback severity name when nothing matches.
    symbol:
        Optional symbolic name (e.g. ``"line-too-long"``).  Only pylint
        exposes this; other tools pass *None*.
    """
    value = (
        (symbol and severity_map.get(symbol))
        or severity_map.get(code, None)
        or severity_map.get(code_type, None)
        or default
    )
    try:
        return lsp.DiagnosticSeverity[value]
    except KeyError:
        return lsp.DiagnosticSeverity.Error


# ---------------------------------------------------------------------------
# Diagnostic construction
# ---------------------------------------------------------------------------


def make_diagnostic(
    *,
    line: int,
    column: int,
    message: str,
    severity: lsp.DiagnosticSeverity,
    code: str = "",
    source: str = "",
    end_line: int | None = None,
    end_column: int | None = None,
    code_description: lsp.CodeDescription | None = None,
    data: Any = None,
) -> lsp.Diagnostic:
    """Build an :class:`lsprotocol.types.Diagnostic`.

    *line* and *column* are **0-based** (LSP convention).  If *end_line*
    or *end_column* are *None* the range degenerates to a point.
    """
    start = lsp.Position(line=line, character=column)
    end = lsp.Position(
        line=end_line if end_line is not None else line,
        character=end_column if end_column is not None else column,
    )
    return lsp.Diagnostic(
        range=lsp.Range(start=start, end=end),
        message=message,
        severity=severity,
        code=code or None,
        code_description=code_description,
        source=source or None,
        data=data,
    )


# ---------------------------------------------------------------------------
# Regex-based diagnostic parsing
# ---------------------------------------------------------------------------


@dataclasses.dataclass(slots=True)
class ParsedRecord:
    """Intermediate representation of a single parsed diagnostic line.

    Provides typed access to the regex-matched groups before they are
    turned into :class:`lsprotocol.types.Diagnostic` objects.
    """

    file: str = ""
    line: int = 0
    column: int = 0
    code: str = ""
    code_type: str = ""
    message: str = ""


def parse_diagnostics_regex(
    content: str,
    pattern: re.Pattern[str],
    severity_map: dict[str, str],
    source: str,
    *,
    line_at_1: bool = True,
    col_at_1: bool = True,
    default_severity: str = "Error",
    record_callback: Callable[[ParsedRecord], lsp.Diagnostic | None] | None = None,
) -> list[lsp.Diagnostic]:
    """Parse tool output into diagnostics using a compiled regex.

    The *pattern* must use **named groups**:

    * ``line`` (required) — 1-based line number
    * ``column`` (optional) — 1-based column number
    * ``type`` (optional) — severity category (``Error``, ``Warning``, …)
    * ``code`` (optional) — machine-readable code
    * ``message`` (optional) — human-readable message
    * ``file`` (optional) — file path (for multi-file output like mypy)

    Parameters
    ----------
    content:
        Raw tool stdout to parse.
    pattern:
        Compiled regex with named groups.
    severity_map:
        User severity overrides.
    source:
        Value for :attr:`Diagnostic.source` (e.g. ``"Flake8"``).
    line_at_1:
        Whether the tool's line numbers are 1-based (subtract 1 for LSP).
    col_at_1:
        Whether the tool's column numbers are 1-based.
    default_severity:
        Fallback severity when neither code nor type matches.
    record_callback:
        Optional callback that receives each :class:`ParsedRecord` and
        returns a :class:`Diagnostic` (or *None* to skip).  When provided
        the default diagnostic construction is bypassed — use this for
        tools like mypy that need note-chaining or custom ranges.
    """
    diagnostics: list[lsp.Diagnostic] = []
    line_offset = 1 if line_at_1 else 0
    col_offset = 1 if col_at_1 else 0

    for line in content.splitlines():
        match = pattern.match(line)
        if not match:
            continue

        data = match.groupdict()
        record = ParsedRecord(
            file=data.get("file") or "",
            line=max(int(data.get("line") or "1") - line_offset, 0),
            column=max(int(data.get("column") or "1") - col_offset, 0),
            code=data.get("code") or "",
            code_type=data.get("type") or "",
            message=data.get("message") or "",
        )

        if record_callback is not None:
            diag = record_callback(record)
            if diag is not None:
                diagnostics.append(diag)
            continue

        severity = get_severity(
            record.code,
            record.code_type,
            severity_map,
            default=default_severity,
        )
        diagnostics.append(
            make_diagnostic(
                line=record.line,
                column=record.column,
                message=record.message,
                severity=severity,
                code=record.code,
                source=source,
            )
        )

    return diagnostics
