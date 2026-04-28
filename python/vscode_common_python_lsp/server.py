# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Shared server infrastructure for Python tool extensions."""

from __future__ import annotations

import importlib.metadata
import json
import os
import pathlib
import sys
import traceback
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

import lsprotocol.types as lsp
from pygls import uris
from pygls.lsp.server import LanguageServer
from pygls.workspace import TextDocument

from . import jsonrpc
from .context import substitute_attr
from .paths import normalize_path
from .runner import RunResult, run_module, run_path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class ToolServerConfig:
    """Configuration for a Python tool extension server.

    Parameters
    ----------
    tool_module:
        Python module name of the tool (e.g. ``"black"``, ``"flake8"``).
    tool_display:
        Human-readable display name (e.g. ``"Black Formatter"``).
    tool_args:
        Default CLI arguments always passed to the tool.
    min_version:
        Minimum supported version string.
    runner_script:
        Path to the bundled JSON-RPC runner script.
    resolve_symlinks:
        Whether to resolve symlinks when normalizing workspace paths.
        All current extension repos use ``False`` to keep workspace
        keys relative to the (possibly symlinked) workspace root.
    default_notification_level:
        Default value for the ``showNotifications`` setting.
    default_settings:
        Tool-specific setting keys and their default values.  These are
        merged into the base defaults returned by
        :meth:`ToolServer.get_global_defaults`.
    """

    tool_module: str
    tool_display: str
    tool_args: list[str] = field(default_factory=list)
    min_version: str = ""
    runner_script: str = ""
    resolve_symlinks: bool = False
    default_notification_level: Literal["off", "onError", "onWarning", "always"] = "off"
    default_settings: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# ToolServer — thin state container + shared utilities
# ---------------------------------------------------------------------------


class ToolServer:
    """Shared server infrastructure for Python tool extensions.

    Wraps a pygls :class:`LanguageServer` and provides settings management,
    tool execution, and logging — the functions that are 100% identical
    across all five extension repos.

    Each repo keeps its own ``lsp_server.py`` that creates a
    ``ToolServer``, registers LSP handlers on :attr:`server`, and calls
    the shared methods as needed.
    """

    def __init__(
        self,
        config: ToolServerConfig,
        *,
        server: LanguageServer | None = None,
    ):
        self.config = config
        self.workspace_settings: dict[str, Any] = {}
        self.global_settings: dict[str, Any] = {}
        if server is None:
            try:
                _pkg_version = importlib.metadata.version("vscode-common-python-lsp")
            except importlib.metadata.PackageNotFoundError:
                _pkg_version = "0.0.0-dev"
            server = LanguageServer(
                name=f"{config.tool_module}-server",
                version=f"v{_pkg_version}",
                max_workers=5,
            )
        self.server = server

    # -----------------------------------------------------------------
    # Settings management
    # -----------------------------------------------------------------

    def get_global_defaults(self) -> dict[str, Any]:
        """Return merged base + tool-specific default settings."""
        base: dict[str, Any] = {
            "path": self.global_settings.get("path", []),
            "interpreter": self.global_settings.get("interpreter", [sys.executable]),
            "args": self.global_settings.get("args", []),
            "importStrategy": self.global_settings.get("importStrategy", "useBundled"),
            "showNotifications": self.global_settings.get(
                "showNotifications", self.config.default_notification_level
            ),
        }
        for key, default in self.config.default_settings.items():
            base[key] = self.global_settings.get(key, default)
        return base

    def update_workspace_settings(self, settings: list[dict[str, Any]] | None) -> None:
        """Populate :attr:`workspace_settings` from the client payload."""
        if not settings:
            key = normalize_path(
                os.getcwd(), resolve_symlinks=self.config.resolve_symlinks
            )
            self.workspace_settings[key] = {
                "cwd": key,
                "workspaceFS": key,
                "workspace": uris.from_fs_path(key),
                **self.get_global_defaults(),
            }
            return

        for setting in settings:
            key = normalize_path(
                uris.to_fs_path(setting["workspace"]),
                resolve_symlinks=self.config.resolve_symlinks,
            )
            self.workspace_settings[key] = {
                **self.get_global_defaults(),
                **setting,
                "workspaceFS": key,
            }

    def get_settings_by_path(self, file_path: pathlib.Path) -> dict[str, Any]:
        """Return workspace settings for the given file path."""
        if not self.workspace_settings:
            cwd = normalize_path(
                os.getcwd(), resolve_symlinks=self.config.resolve_symlinks
            )
            return {
                "cwd": cwd,
                "workspaceFS": cwd,
                "workspace": uris.from_fs_path(cwd),
                **self.get_global_defaults(),
            }

        workspaces = {s["workspaceFS"] for s in self.workspace_settings.values()}

        while file_path != file_path.parent:
            str_file_path = normalize_path(
                str(file_path), resolve_symlinks=self.config.resolve_symlinks
            )
            if str_file_path in workspaces:
                return self.workspace_settings[str_file_path]
            file_path = file_path.parent

        return list(self.workspace_settings.values())[0]

    def get_document_key(self, document: TextDocument) -> str | None:
        """Return the workspace key for the given document, or ``None``."""
        if self.workspace_settings:
            document_workspace = pathlib.Path(document.path)
            workspaces = {s["workspaceFS"] for s in self.workspace_settings.values()}

            while document_workspace != document_workspace.parent:
                norm_path = normalize_path(
                    str(document_workspace),
                    resolve_symlinks=self.config.resolve_symlinks,
                )
                if norm_path in workspaces:
                    return norm_path
                document_workspace = document_workspace.parent

        return None

    def get_settings_by_document(self, document: TextDocument | None) -> dict[str, Any]:
        """Return workspace settings for the given document."""
        if document is None or document.path is None:
            if not self.workspace_settings:
                cwd = normalize_path(
                    os.getcwd(), resolve_symlinks=self.config.resolve_symlinks
                )
                return {
                    "cwd": cwd,
                    "workspaceFS": cwd,
                    "workspace": uris.from_fs_path(cwd),
                    **self.get_global_defaults(),
                }
            return list(self.workspace_settings.values())[0]

        key = self.get_document_key(document)
        if key is not None:
            return self.workspace_settings[key]

        key = normalize_path(
            str(pathlib.Path(document.path).parent),
            resolve_symlinks=self.config.resolve_symlinks,
        )
        return {
            "cwd": key,
            "workspaceFS": key,
            "workspace": uris.from_fs_path(key),
            **self.get_global_defaults(),
        }

    # -----------------------------------------------------------------
    # CWD resolution
    # -----------------------------------------------------------------

    def get_cwd(
        self,
        settings: dict[str, Any],
        document: TextDocument | None = None,
        *,
        document_path: str | None = None,
    ) -> str:
        """Resolve the working directory with VS Code variable substitution.

        Parameters
        ----------
        settings:
            Workspace settings dict (must contain ``workspaceFS``).
        document:
            The current text document, if available.
        document_path:
            Explicit path override.  When provided, takes precedence over
            ``document.path`` — useful for notebook cell handling where
            the cell's URI differs from the notebook file path.
        """
        cwd = settings.get("cwd", settings["workspaceFS"])
        workspace_fs = settings["workspaceFS"]

        file_path = document_path or (document.path if document else None)

        if file_path:
            file_dir = os.path.dirname(file_path)
            file_basename = os.path.basename(file_path)
            file_stem, file_ext = os.path.splitext(file_basename)

            try:
                rel_file = os.path.relpath(file_path, workspace_fs)
            except ValueError:
                rel_file = file_path

            try:
                rel_dir = os.path.relpath(file_dir, workspace_fs)
            except ValueError:
                rel_dir = file_dir

            substitutions = {
                "${file}": file_path,
                "${fileBasename}": file_basename,
                "${fileBasenameNoExtension}": file_stem,
                "${fileExtname}": file_ext,
                "${fileDirname}": file_dir,
                "${fileDirnameBasename}": os.path.basename(file_dir),
                "${relativeFile}": rel_file,
                "${relativeFileDirname}": rel_dir,
                "${fileWorkspaceFolder}": workspace_fs,
            }

            for token, value in substitutions.items():
                cwd = cwd.replace(token, value)
        else:
            # Without a document we cannot resolve file-related variables.
            if "${file" in cwd or "${relativeFile" in cwd:
                cwd = workspace_fs

        return cwd

    # -----------------------------------------------------------------
    # Tool execution
    # -----------------------------------------------------------------

    def execute_tool(
        self,
        *,
        argv: Sequence[str],
        mode: Literal["path", "rpc", "module"],
        settings: dict[str, Any],
        use_stdin: bool = False,
        cwd: str = "",
        workspace: str = "",
        source: str = "",
        runner_script: str | None = None,
        env: dict[str, str] | None = None,
        timeout: float | None = None,
    ) -> RunResult:
        """Execute the tool in the specified mode.

        Parameters
        ----------
        argv:
            Full command-line argument list (caller is responsible for
            building this — shared code does not impose arg ordering).
        mode:
            One of ``"path"``, ``"rpc"``, or ``"module"``.
        settings:
            Workspace settings dict (used for interpreter lookup in RPC).
        use_stdin:
            Whether to pipe source via stdin.
        cwd:
            Working directory for the tool process.
        workspace:
            Workspace key for RPC process management.
        source:
            Document source text (for stdin and RPC).
        runner_script:
            Override for :attr:`ToolServerConfig.runner_script`.
        env:
            Extra environment variables for path and RPC modes.
        timeout:
            Timeout in seconds for path and RPC modes (``None`` = no timeout).
        """
        runner = runner_script or self.config.runner_script

        if mode == "path":
            self.log_to_output(" ".join(argv))
            self.log_to_output(f"CWD Server: {cwd}")
            result = run_path(
                argv=argv,
                use_stdin=use_stdin,
                cwd=cwd,
                source=source,
                env=env,
                timeout=timeout,
            )
            if result.stderr:
                self.log_to_output(result.stderr)

        elif mode == "rpc":
            if not workspace:
                raise ValueError("workspace is required for RPC execution mode")
            self.log_to_output(" ".join(settings["interpreter"] + ["-m"] + list(argv)))
            self.log_to_output(f"CWD {self.config.tool_display}: {cwd}")
            rpc_result = jsonrpc.run_over_json_rpc(
                workspace=workspace,
                interpreter=settings["interpreter"],
                module=self.config.tool_module,
                argv=argv,
                use_stdin=use_stdin,
                cwd=cwd,
                runner_script=runner,
                source=source,
                env=env,
                timeout=timeout,
            )
            result = self._rpc_to_run_result(rpc_result)

        elif mode == "module":
            self.log_to_output(" ".join([sys.executable, "-m"] + list(argv)))
            self.log_to_output(f"CWD {self.config.tool_display}: {cwd}")
            with substitute_attr(sys, "path", [""] + sys.path[:]):
                try:
                    result = run_module(
                        module=self.config.tool_module,
                        argv=argv,
                        use_stdin=use_stdin,
                        cwd=cwd,
                        source=source,
                    )
                except Exception:
                    self.log_error(traceback.format_exc(chain=True))
                    raise
            if result.stderr:
                self.log_to_output(result.stderr)

        else:
            raise ValueError(
                f"Unknown execution mode: {mode!r}."
                " Expected 'path', 'rpc', or 'module'."
            )

        return result

    def _rpc_to_run_result(self, rpc_result: jsonrpc.RpcRunResult) -> RunResult:
        """Convert an :class:`RpcRunResult` to a :class:`RunResult`, logging errors."""
        error = ""
        if rpc_result.exception:
            self.log_error(rpc_result.exception)
            error = rpc_result.exception
            if rpc_result.stderr:
                self.log_to_output(rpc_result.stderr)
                error += "\n" + rpc_result.stderr
        elif rpc_result.stderr:
            self.log_to_output(rpc_result.stderr)
            error = rpc_result.stderr
        return RunResult(rpc_result.stdout, error)

    # -----------------------------------------------------------------
    # Logging
    # -----------------------------------------------------------------

    def log_to_output(
        self,
        message: str,
        msg_type: lsp.MessageType = lsp.MessageType.Log,
    ) -> None:
        """Log a message to the Output channel."""
        self.server.window_log_message(
            lsp.LogMessageParams(type=msg_type, message=message)
        )

    def log_error(self, message: str) -> None:
        """Log an error and optionally show a notification."""
        self.server.window_log_message(
            lsp.LogMessageParams(type=lsp.MessageType.Error, message=message)
        )
        if os.getenv("LS_SHOW_NOTIFICATION", "off") in [
            "onError",
            "onWarning",
            "always",
        ]:
            self.server.window_show_message(
                lsp.ShowMessageParams(type=lsp.MessageType.Error, message=message)
            )

    def log_warning(self, message: str) -> None:
        """Log a warning and optionally show a notification."""
        self.server.window_log_message(
            lsp.LogMessageParams(type=lsp.MessageType.Warning, message=message)
        )
        if os.getenv("LS_SHOW_NOTIFICATION", "off") in [
            "onWarning",
            "always",
        ]:
            self.server.window_show_message(
                lsp.ShowMessageParams(type=lsp.MessageType.Warning, message=message)
            )

    def log_always(self, message: str) -> None:
        """Log an info message and show a notification only when ``always``."""
        self.server.window_log_message(
            lsp.LogMessageParams(type=lsp.MessageType.Info, message=message)
        )
        if os.getenv("LS_SHOW_NOTIFICATION", "off") == "always":
            self.server.window_show_message(
                lsp.ShowMessageParams(type=lsp.MessageType.Info, message=message)
            )

    # -----------------------------------------------------------------
    # Lifecycle helpers
    # -----------------------------------------------------------------

    def apply_settings(self, params: lsp.InitializeParams) -> None:
        """Apply global and workspace settings from an initialize request.

        Call this from your ``@server.feature(lsp.INITIALIZE)`` handler.
        Repos can add tool-specific logic before/after this call.
        """
        initialization_options = params.initialization_options or {}
        self.global_settings.update(**initialization_options.get("globalSettings", {}))
        settings = initialization_options.get("settings")
        self.update_workspace_settings(settings)

    def log_startup_info(self, settings: list[dict[str, Any]] | None = None) -> None:
        """Log CWD, settings, and sys.path at server startup.

        Call this from your ``@server.feature(lsp.INITIALIZE)`` handler
        after :meth:`apply_settings`.
        """
        self.log_to_output(f"CWD Server: {os.getcwd()}")

        if settings is not None:
            self.log_to_output(
                "Settings used to run Server:\r\n"
                f"{json.dumps(settings, indent=4, ensure_ascii=False)}\r\n"
            )
        self.log_to_output(
            "Global settings:\r\n"
            f"{json.dumps(self.global_settings, indent=4, ensure_ascii=False)}\r\n"
        )

        paths = "\r\n   ".join(sys.path)
        self.log_to_output(f"sys.path used to run Server:\r\n   {paths}")

    def handle_exit(self) -> None:
        """Shut down JSON-RPC processes.

        Call this from your ``@server.feature(lsp.EXIT)`` handler.
        Repos with additional cleanup (e.g. mypy daemon) should perform
        their own cleanup before or after this call.
        """
        jsonrpc.shutdown_json_rpc()

    def handle_shutdown(self) -> None:
        """Shut down JSON-RPC processes.

        Call this from your ``@server.feature(lsp.SHUTDOWN)`` handler.
        """
        jsonrpc.shutdown_json_rpc()
