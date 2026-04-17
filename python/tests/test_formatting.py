# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.formatting."""

from vscode_common_python_lsp.formatting import (
    is_notebook_cell,
    match_line_endings,
    strip_trailing_newline,
)

# ---------------------------------------------------------------------------
# match_line_endings
# ---------------------------------------------------------------------------


class TestMatchLineEndings:
    def test_lf_to_crlf(self):
        doc_source = "line1\r\nline2\r\n"
        edited = "line1\nline2\n"
        result = match_line_endings(doc_source, edited)
        assert result == "line1\r\nline2\r\n"

    def test_crlf_to_lf(self):
        doc_source = "line1\nline2\n"
        edited = "line1\r\nline2\r\n"
        result = match_line_endings(doc_source, edited)
        assert result == "line1\nline2\n"

    def test_same_endings_unchanged(self):
        doc_source = "line1\nline2\n"
        edited = "changed\n"
        result = match_line_endings(doc_source, edited)
        assert result == "changed\n"

    def test_empty_document(self):
        result = match_line_endings("", "hello\n")
        assert result == "hello\n"

    def test_empty_edited(self):
        result = match_line_endings("line\n", "")
        assert result == ""


# ---------------------------------------------------------------------------
# is_notebook_cell
# ---------------------------------------------------------------------------


class TestIsNotebookCell:
    def test_notebook_cell(self):
        assert is_notebook_cell("vscode-notebook-cell:/foo.py") is True

    def test_regular_file(self):
        assert is_notebook_cell("file:///foo.py") is False


# ---------------------------------------------------------------------------
# strip_trailing_newline
# ---------------------------------------------------------------------------


class TestStripTrailingNewline:
    def test_lf(self):
        assert strip_trailing_newline("hello\n") == "hello"

    def test_crlf(self):
        assert strip_trailing_newline("hello\r\n") == "hello"

    def test_no_newline(self):
        assert strip_trailing_newline("hello") == "hello"

    def test_only_strips_one(self):
        assert strip_trailing_newline("hello\n\n") == "hello\n"
