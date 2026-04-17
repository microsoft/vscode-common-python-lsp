# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.notebook."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock

import lsprotocol.types as lsp

from vscode_common_python_lsp.notebook import (
    CellOffset,
    SyntheticDocument,
    build_notebook_source,
    get_cell_for_line,
    remap_diagnostics_to_cells,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass
class FakeDocument:
    source: str
    language_id: str = "python"


def _make_cell(uri: str, kind=lsp.NotebookCellKind.Code):
    cell = MagicMock()
    cell.kind = kind
    cell.document = uri
    return cell


# ---------------------------------------------------------------------------
# SyntheticDocument
# ---------------------------------------------------------------------------


class TestSyntheticDocument:
    def test_defaults(self):
        doc = SyntheticDocument(uri="nb:1", path="/nb.ipynb", source="x=1")
        assert doc.language_id == "python"
        assert doc.version == 0


# ---------------------------------------------------------------------------
# build_notebook_source
# ---------------------------------------------------------------------------


class TestBuildNotebookSource:
    def test_single_cell(self):
        cells = [_make_cell("cell:1")]
        docs = {"cell:1": FakeDocument(source="x = 1\ny = 2\n")}
        source, cell_map = build_notebook_source(cells, docs.get)
        assert source == "x = 1\ny = 2\n"
        assert len(cell_map) == 1
        assert cell_map[0] == CellOffset("cell:1", 0, 2)

    def test_multiple_cells(self):
        cells = [_make_cell("cell:1"), _make_cell("cell:2")]
        docs = {
            "cell:1": FakeDocument(source="a = 1\n"),
            "cell:2": FakeDocument(source="b = 2\n"),
        }
        source, cell_map = build_notebook_source(cells, docs.get)
        assert source == "a = 1\nb = 2\n"
        assert cell_map[0] == CellOffset("cell:1", 0, 1)
        assert cell_map[1] == CellOffset("cell:2", 1, 1)

    def test_skips_markdown_cells(self):
        cells = [
            _make_cell("cell:1", kind=lsp.NotebookCellKind.Markup),
            _make_cell("cell:2"),
        ]
        docs = {"cell:2": FakeDocument(source="x = 1\n")}
        source, cell_map = build_notebook_source(cells, docs.get)
        assert source == "x = 1\n"
        assert len(cell_map) == 1

    def test_skips_non_python(self):
        cells = [_make_cell("cell:1")]
        docs = {
            "cell:1": FakeDocument(source="console.log(1)", language_id="javascript")
        }
        source, cell_map = build_notebook_source(cells, docs.get)
        assert source == ""
        assert len(cell_map) == 0

    def test_magic_lines_sanitized(self):
        cells = [_make_cell("cell:1")]
        docs = {
            "cell:1": FakeDocument(
                source="%matplotlib inline\nx = 1\n!pip install foo\n"
            )
        }
        source, cell_map = build_notebook_source(cells, docs.get)
        lines = source.splitlines(keepends=True)
        assert lines[0] == "pass\n"
        assert lines[1] == "x = 1\n"
        assert lines[2] == "pass\n"

    def test_trailing_newline_added(self):
        """Source without trailing newline gets one."""
        cells = [_make_cell("cell:1")]
        docs = {"cell:1": FakeDocument(source="x = 1")}
        source, _ = build_notebook_source(cells, docs.get)
        assert source.endswith("\n")

    def test_empty_cell_skipped(self):
        cells = [_make_cell("cell:1"), _make_cell("cell:2")]
        docs = {
            "cell:1": FakeDocument(source=""),
            "cell:2": FakeDocument(source="x = 1\n"),
        }
        source, cell_map = build_notebook_source(cells, docs.get)
        assert len(cell_map) == 1

    def test_custom_sanitizer(self):
        cells = [_make_cell("cell:1")]
        docs = {"cell:1": FakeDocument(source="%magic\nx = 1\n")}
        source, _ = build_notebook_source(
            cells, docs.get, sanitize_line=lambda line: f"# {line}"
        )
        assert source.startswith("# %magic\n")

    def test_missing_document_skipped(self):
        cells = [_make_cell("cell:1")]
        source, cell_map = build_notebook_source(cells, lambda uri: None)
        assert source == ""
        assert len(cell_map) == 0


# ---------------------------------------------------------------------------
# get_cell_for_line
# ---------------------------------------------------------------------------


class TestGetCellForLine:
    def test_finds_correct_cell(self):
        cell_map = [
            CellOffset("cell:1", 0, 3),
            CellOffset("cell:2", 3, 2),
        ]
        assert get_cell_for_line(0, cell_map).cell_uri == "cell:1"
        assert get_cell_for_line(2, cell_map).cell_uri == "cell:1"
        assert get_cell_for_line(3, cell_map).cell_uri == "cell:2"
        assert get_cell_for_line(4, cell_map).cell_uri == "cell:2"

    def test_out_of_range_returns_none(self):
        cell_map = [CellOffset("cell:1", 0, 3)]
        assert get_cell_for_line(5, cell_map) is None

    def test_empty_cell_map(self):
        assert get_cell_for_line(0, []) is None


# ---------------------------------------------------------------------------
# remap_diagnostics_to_cells
# ---------------------------------------------------------------------------


class TestRemapDiagnosticsToCells:
    def _make_diag(self, start_line, start_char, end_line, end_char, msg="msg"):
        return lsp.Diagnostic(
            range=lsp.Range(
                start=lsp.Position(line=start_line, character=start_char),
                end=lsp.Position(line=end_line, character=end_char),
            ),
            message=msg,
            severity=lsp.DiagnosticSeverity.Error,
            code="E001",
            source="Test",
        )

    def test_single_cell_remap(self):
        cell_map = [CellOffset("cell:1", 0, 5)]
        diag = self._make_diag(2, 5, 2, 10)
        result = remap_diagnostics_to_cells([diag], cell_map)
        assert len(result["cell:1"]) == 1
        remapped = result["cell:1"][0]
        assert remapped.range.start.line == 2
        assert remapped.range.start.character == 5

    def test_second_cell_offset(self):
        cell_map = [
            CellOffset("cell:1", 0, 3),
            CellOffset("cell:2", 3, 2),
        ]
        diag = self._make_diag(4, 0, 4, 5)  # Line 4 in combined = line 1 in cell:2
        result = remap_diagnostics_to_cells([diag], cell_map)
        assert len(result["cell:2"]) == 1
        assert result["cell:2"][0].range.start.line == 1

    def test_diagnostic_outside_cells_discarded(self):
        cell_map = [CellOffset("cell:1", 0, 3)]
        diag = self._make_diag(10, 0, 10, 5)
        result = remap_diagnostics_to_cells([diag], cell_map)
        assert len(result["cell:1"]) == 0

    def test_cross_cell_range_clamped(self):
        cell_map = [
            CellOffset("cell:1", 0, 3),
            CellOffset("cell:2", 3, 2),
        ]
        diag = self._make_diag(1, 0, 4, 5)  # Spans from cell:1 into cell:2
        result = remap_diagnostics_to_cells([diag], cell_map)
        assert len(result["cell:1"]) == 1
        remapped = result["cell:1"][0]
        assert remapped.range.start.line == 1
        assert remapped.range.end.line == 2  # Clamped to cell boundary
        assert remapped.range.end.character == 0

    def test_preserves_diagnostic_fields(self):
        cell_map = [CellOffset("cell:1", 0, 5)]
        diag = self._make_diag(0, 0, 0, 5, msg="preserve me")
        result = remap_diagnostics_to_cells([diag], cell_map)
        remapped = result["cell:1"][0]
        assert remapped.message == "preserve me"
        assert remapped.severity == lsp.DiagnosticSeverity.Error
        assert remapped.code == "E001"
        assert remapped.source == "Test"

    def test_empty_diagnostics(self):
        cell_map = [CellOffset("cell:1", 0, 3)]
        result = remap_diagnostics_to_cells([], cell_map)
        assert result == {"cell:1": []}
