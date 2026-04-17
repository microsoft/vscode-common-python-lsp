# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.diagnostics."""

import re

import lsprotocol.types as lsp

from vscode_common_python_lsp.diagnostics import (
    ParsedRecord,
    get_severity,
    make_diagnostic,
    parse_diagnostics_regex,
)

# ---------------------------------------------------------------------------
# get_severity
# ---------------------------------------------------------------------------

FLAKE8_SEVERITY = {"E": "Error", "F": "Error", "I": "Information", "W": "Warning"}
PYLINT_SEVERITY = {
    "convention": "Information",
    "error": "Error",
    "fatal": "Error",
    "refactor": "Hint",
    "warning": "Warning",
}
MYPY_SEVERITY = {"error": "Error", "note": "Information"}


class TestGetSeverity:
    def test_lookup_by_code(self):
        assert (
            get_severity("E501", "Error", FLAKE8_SEVERITY)
            == lsp.DiagnosticSeverity.Error
        )

    def test_lookup_by_code_type(self):
        assert (
            get_severity("X999", "W", FLAKE8_SEVERITY) == lsp.DiagnosticSeverity.Warning
        )

    def test_fallback_to_default(self):
        assert get_severity("X999", "unknown", {}) == lsp.DiagnosticSeverity.Error

    def test_custom_default(self):
        assert (
            get_severity("X999", "unknown", {}, default="Warning")
            == lsp.DiagnosticSeverity.Warning
        )

    def test_pylint_symbol_lookup(self):
        severity_map = {**PYLINT_SEVERITY, "line-too-long": "Warning"}
        result = get_severity(
            "C0301", "convention", severity_map, symbol="line-too-long"
        )
        assert result == lsp.DiagnosticSeverity.Warning

    def test_pylint_symbol_takes_priority(self):
        severity_map = {
            "line-too-long": "Hint",
            "C0301": "Error",
            "convention": "Information",
        }
        result = get_severity(
            "C0301", "convention", severity_map, symbol="line-too-long"
        )
        assert result == lsp.DiagnosticSeverity.Hint

    def test_mypy_code_lookup(self):
        assert (
            get_severity("error", "error", MYPY_SEVERITY)
            == lsp.DiagnosticSeverity.Error
        )
        assert (
            get_severity("note", "note", MYPY_SEVERITY)
            == lsp.DiagnosticSeverity.Information
        )

    def test_invalid_severity_name(self):
        result = get_severity("X", "X", {"X": "NotAReal"})
        assert result == lsp.DiagnosticSeverity.Error

    def test_flake8_prefix_match(self):
        """Flake8 uses exact match on code, not prefix. Prefix is the caller's job."""
        assert get_severity("E501", "", {"E": "Error"}) == lsp.DiagnosticSeverity.Error


# ---------------------------------------------------------------------------
# make_diagnostic
# ---------------------------------------------------------------------------


class TestMakeDiagnostic:
    def test_basic(self):
        diag = make_diagnostic(
            line=10,
            column=5,
            message="test error",
            severity=lsp.DiagnosticSeverity.Error,
            code="E001",
            source="TestTool",
        )
        assert diag.range.start.line == 10
        assert diag.range.start.character == 5
        assert diag.range.end.line == 10
        assert diag.range.end.character == 5
        assert diag.message == "test error"
        assert diag.severity == lsp.DiagnosticSeverity.Error
        assert diag.code == "E001"
        assert diag.source == "TestTool"

    def test_with_end_range(self):
        diag = make_diagnostic(
            line=10,
            column=0,
            message="msg",
            severity=lsp.DiagnosticSeverity.Warning,
            end_line=12,
            end_column=5,
        )
        assert diag.range.end.line == 12
        assert diag.range.end.character == 5

    def test_empty_code_is_none(self):
        diag = make_diagnostic(
            line=0, column=0, message="m", severity=lsp.DiagnosticSeverity.Error
        )
        assert diag.code is None
        assert diag.source is None


# ---------------------------------------------------------------------------
# parse_diagnostics_regex
# ---------------------------------------------------------------------------

# Flake8-style regex
FLAKE8_RE = re.compile(
    r"(?P<line>\d+),(?P<column>-?\d+),"
    r"(?P<type>\w+),(?P<code>\w+\d+):(?P<message>[^\r\n]*)"
)


class TestParseDiagnosticsRegex:
    def test_flake8_output(self):
        content = (
            "5,1,Error,E302:expected 2 blank lines, got 1\n"
            "10,80,Warning,W501:line too long"
        )
        result = parse_diagnostics_regex(
            content, FLAKE8_RE, FLAKE8_SEVERITY, "Flake8"
        )
        assert len(result) == 2
        assert result[0].range.start.line == 4  # 5 - 1 (line_at_1)
        assert result[0].range.start.character == 0  # 1 - 1 (col_at_1)
        assert result[0].code == "E302"
        assert result[0].message == "expected 2 blank lines, got 1"
        assert result[0].source == "Flake8"

    def test_no_matches(self):
        result = parse_diagnostics_regex(
            "no matching lines\n", FLAKE8_RE, FLAKE8_SEVERITY, "Flake8"
        )
        assert result == []

    def test_empty_content(self):
        result = parse_diagnostics_regex("", FLAKE8_RE, FLAKE8_SEVERITY, "Flake8")
        assert result == []

    def test_line_at_0(self):
        content = "0,0,Error,E001:msg\n"
        result = parse_diagnostics_regex(
            content,
            FLAKE8_RE,
            FLAKE8_SEVERITY,
            "Flake8",
            line_at_1=False,
            col_at_1=False,
        )
        assert result[0].range.start.line == 0
        assert result[0].range.start.character == 0

    def test_record_callback(self):
        """record_callback lets tools like mypy do custom diagnostic construction."""
        records: list[ParsedRecord] = []

        def capture(record: ParsedRecord) -> lsp.Diagnostic | None:
            records.append(record)
            return make_diagnostic(
                line=record.line,
                column=record.column,
                message=f"CUSTOM: {record.message}",
                severity=lsp.DiagnosticSeverity.Hint,
                code=record.code,
                source="Custom",
            )

        content = "5,1,Error,E302:expected 2 blank lines, got 1\n"
        result = parse_diagnostics_regex(
            content, FLAKE8_RE, {}, "Flake8", record_callback=capture
        )
        assert len(records) == 1
        assert records[0].code == "E302"
        assert result[0].message == "CUSTOM: expected 2 blank lines, got 1"

    def test_negative_column_clamped(self):
        content = "1,-1,Error,E001:msg\n"
        result = parse_diagnostics_regex(content, FLAKE8_RE, FLAKE8_SEVERITY, "Flake8")
        assert result[0].range.start.character == 0  # clamped to 0
