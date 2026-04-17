# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.code_actions."""

import lsprotocol.types as lsp
import pytest

from vscode_common_python_lsp.code_actions import (
    QuickFixRegistrationError,
    QuickFixRegistry,
    command_quick_fix,
    create_workspace_edit,
)

# ---------------------------------------------------------------------------
# QuickFixRegistry
# ---------------------------------------------------------------------------


class TestQuickFixRegistry:
    def test_register_single_code(self):
        registry = QuickFixRegistry()

        @registry.quick_fix(codes="E001")
        def handler(doc, diags):
            return []

        assert registry.solutions("E001") is handler

    def test_register_multiple_codes(self):
        registry = QuickFixRegistry()

        @registry.quick_fix(codes=["E001", "E002"])
        def handler(doc, diags):
            return []

        assert registry.solutions("E001") is handler
        assert registry.solutions("E002") is handler

    def test_unknown_code_returns_none(self):
        registry = QuickFixRegistry()
        assert registry.solutions("X999") is None

    def test_none_code_returns_none(self):
        registry = QuickFixRegistry()
        assert registry.solutions(None) is None

    def test_duplicate_code_raises(self):
        registry = QuickFixRegistry()

        @registry.quick_fix(codes="E001")
        def handler1(doc, diags):
            return []

        with pytest.raises(QuickFixRegistrationError):

            @registry.quick_fix(codes="E001")
            def handler2(doc, diags):
                return []

    def test_duplicate_in_list_raises(self):
        registry = QuickFixRegistry()

        @registry.quick_fix(codes="E001")
        def handler1(doc, diags):
            return []

        with pytest.raises(QuickFixRegistrationError):

            @registry.quick_fix(codes=["E001", "E002"])
            def handler2(doc, diags):
                return []

    def test_decorator_returns_function(self):
        """Decorator should return the original function for chaining."""
        registry = QuickFixRegistry()

        @registry.quick_fix(codes="E001")
        def handler(doc, diags):
            return ["result"]

        # The decorated function is still callable
        assert handler(None, []) == ["result"]


# ---------------------------------------------------------------------------
# command_quick_fix
# ---------------------------------------------------------------------------


class TestCommandQuickFix:
    def test_basic(self):
        diag = lsp.Diagnostic(
            range=lsp.Range(
                start=lsp.Position(line=0, character=0),
                end=lsp.Position(line=0, character=0),
            ),
            message="test",
        )
        action = command_quick_fix(
            diagnostics=[diag],
            title="Fix it",
            command="editor.action.fix",
        )
        assert action.title == "Fix it"
        assert action.kind == lsp.CodeActionKind.QuickFix
        assert action.diagnostics == [diag]
        assert action.command.command == "editor.action.fix"

    def test_with_args(self):
        action = command_quick_fix(
            diagnostics=[],
            title="Fix",
            command="cmd",
            args=["arg1", 42],
        )
        assert action.command.arguments == ["arg1", 42]


# ---------------------------------------------------------------------------
# create_workspace_edit
# ---------------------------------------------------------------------------


class TestCreateWorkspaceEdit:
    def test_basic(self):
        edit = lsp.TextEdit(
            range=lsp.Range(
                start=lsp.Position(line=0, character=0),
                end=lsp.Position(line=1, character=0),
            ),
            new_text="replaced\n",
        )
        ws_edit = create_workspace_edit("file:///a.py", 5, [edit])
        assert len(ws_edit.document_changes) == 1
        doc_edit = ws_edit.document_changes[0]
        assert doc_edit.text_document.uri == "file:///a.py"
        assert doc_edit.text_document.version == 5
        assert doc_edit.edits == [edit]

    def test_none_version_defaults_to_0(self):
        ws_edit = create_workspace_edit("file:///a.py", None, [])
        assert ws_edit.document_changes[0].text_document.version == 0
