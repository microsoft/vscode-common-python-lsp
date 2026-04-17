# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Code action helpers shared by Python tool extensions.

Provides:
* :class:`QuickFixRegistry` — decorator-based registry for quick-fix
  code actions (shared by flake8 and pylint).
* :func:`command_quick_fix` — build a command-based
  :class:`lsprotocol.types.CodeAction`.
* :func:`create_workspace_edit` — build a
  :class:`lsprotocol.types.WorkspaceEdit` for a single document.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import lsprotocol.types as lsp

# ---------------------------------------------------------------------------
# QuickFix registry
# ---------------------------------------------------------------------------


class QuickFixRegistrationError(Exception):
    """Raised when a quick-fix code is registered more than once."""

    def __init__(self, code: str) -> None:
        super().__init__(f"Quick fix already registered for code: {code!r}")
        self.code = code


class QuickFixRegistry:
    """Manages quick fixes registered using the :meth:`quick_fix` decorator.

    Usage::

        QUICK_FIXES = QuickFixRegistry()

        @QUICK_FIXES.quick_fix(codes=["E226", "E227"])
        def fix_format(document, diagnostics):
            return [command_quick_fix(...)]
    """

    def __init__(self) -> None:
        self._solutions: dict[
            str,
            Callable[[Any, list[lsp.Diagnostic]], list[lsp.CodeAction]],
        ] = {}

    def quick_fix(
        self,
        codes: str | list[str],
    ) -> Callable[..., Any]:
        """Decorator for registering quick fixes for one or more codes."""

        def decorator(
            func: Callable[[Any, list[lsp.Diagnostic]], list[lsp.CodeAction]],
        ) -> Callable[[Any, list[lsp.Diagnostic]], list[lsp.CodeAction]]:
            if isinstance(codes, str):
                if codes in self._solutions:
                    raise QuickFixRegistrationError(codes)
                self._solutions[codes] = func
            else:
                for code in codes:
                    if code in self._solutions:
                        raise QuickFixRegistrationError(code)
                for code in codes:
                    self._solutions[code] = func
            return func

        return decorator

    def solutions(
        self,
        code: str | None,
    ) -> Callable[[Any, list[lsp.Diagnostic]], list[lsp.CodeAction]] | None:
        """Return the quick-fix handler for *code*, or *None*."""
        if code is None:
            return None
        return self._solutions.get(code)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def command_quick_fix(
    diagnostics: list[lsp.Diagnostic],
    title: str,
    command: str,
    args: list[Any] | None = None,
) -> lsp.CodeAction:
    """Build a command-based :class:`CodeAction`."""
    return lsp.CodeAction(
        title=title,
        kind=lsp.CodeActionKind.QuickFix,
        diagnostics=diagnostics,
        command=lsp.Command(title=title, command=command, arguments=args),
    )


def create_workspace_edit(
    document_uri: str,
    document_version: int | None,
    text_edits: list[lsp.TextEdit],
) -> lsp.WorkspaceEdit:
    """Build a :class:`WorkspaceEdit` for a single document.

    Parameters
    ----------
    document_uri:
        The document's URI.
    document_version:
        The document's version (``None`` → 0 per LSP convention).
    text_edits:
        The edits to apply.
    """
    return lsp.WorkspaceEdit(
        document_changes=[
            lsp.TextDocumentEdit(
                text_document=lsp.OptionalVersionedTextDocumentIdentifier(
                    uri=document_uri,
                    version=document_version if document_version is not None else 0,
                ),
                edits=text_edits,
            )
        ],
    )
