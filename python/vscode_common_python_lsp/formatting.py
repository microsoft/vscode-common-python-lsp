# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Formatting helpers shared by Python tool extensions."""

from __future__ import annotations


def _get_line_endings(lines: list[str]) -> str | None:
    """Detect the dominant line ending in *lines*.

    Returns ``"\\r\\n"`` or ``"\\n"`` (or *None* when indeterminate).
    """
    crlf = sum(1 for line in lines if line.endswith("\r\n"))
    lf = sum(1 for line in lines if line.endswith("\n") and not line.endswith("\r\n"))
    if crlf == 0 and lf == 0:
        return None
    return "\r\n" if crlf > lf else "\n"


def match_line_endings(document_source: str, edited_text: str) -> str:
    """Ensure *edited_text* uses the same line endings as *document_source*.

    This is identical across all 5 extension repos and prevents spurious
    diffs when the tool normalises line endings differently from the editor.
    """
    expected = _get_line_endings(document_source.splitlines(keepends=True))
    actual = _get_line_endings(edited_text.splitlines(keepends=True))
    if actual == expected or actual is None or expected is None:
        return edited_text
    return edited_text.replace(actual, expected)


def is_notebook_cell(uri: str) -> bool:
    """Return *True* if *uri* refers to a notebook cell."""
    return uri.startswith("vscode-notebook-cell")


def strip_trailing_newline(text: str) -> str:
    """Strip a single trailing newline (for notebook cell formatting)."""
    if text.endswith("\r\n"):
        return text[:-2]
    if text.endswith("\n"):
        return text[:-1]
    return text
