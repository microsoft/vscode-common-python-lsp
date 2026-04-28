# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.server."""

from __future__ import annotations

import importlib.metadata
import os
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch

import pytest

from vscode_common_python_lsp.server import ToolServer, ToolServerConfig

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BASIC_CONFIG = ToolServerConfig(
    tool_module="testtool",
    tool_display="Test Tool",
    tool_args=["--default-arg"],
    runner_script="/path/to/runner.py",
)


def _make_server(config: ToolServerConfig | None = None) -> ToolServer:
    """Create a ToolServer with a mock LanguageServer."""
    mock_lsp = MagicMock()
    return ToolServer(config or BASIC_CONFIG, server=mock_lsp)


def _make_document(path: str = "/workspace/src/main.py") -> MagicMock:
    doc = MagicMock()
    doc.path = path
    doc.source = "print('hello')"
    return doc


# ---------------------------------------------------------------------------
# ToolServerConfig
# ---------------------------------------------------------------------------


class TestToolServerConfig:
    def test_defaults(self):
        cfg = ToolServerConfig(tool_module="mod", tool_display="Mod")
        assert cfg.tool_args == []
        assert cfg.min_version == ""
        assert cfg.runner_script == ""
        assert cfg.resolve_symlinks is False
        assert cfg.default_notification_level == "off"
        assert cfg.default_settings == {}

    def test_custom_settings(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_settings={"severity": {"E": "Error"}, "enabled": True},
        )
        assert cfg.default_settings["severity"] == {"E": "Error"}


# ---------------------------------------------------------------------------
# Settings management
# ---------------------------------------------------------------------------


class TestGetGlobalDefaults:
    def test_base_keys_present(self):
        ts = _make_server()
        defaults = ts.get_global_defaults()
        assert "path" in defaults
        assert "interpreter" in defaults
        assert "args" in defaults
        assert "importStrategy" in defaults
        assert "showNotifications" in defaults

    def test_interpreter_defaults_to_sys_executable(self):
        ts = _make_server()
        defaults = ts.get_global_defaults()
        assert defaults["interpreter"] == [sys.executable]

    def test_global_settings_override_base(self):
        ts = _make_server()
        ts.global_settings["path"] = ["/usr/bin/tool"]
        defaults = ts.get_global_defaults()
        assert defaults["path"] == ["/usr/bin/tool"]

    def test_tool_specific_defaults_merged(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_settings={"enabled": True, "severity": {"E": "Error"}},
        )
        ts = _make_server(cfg)
        defaults = ts.get_global_defaults()
        assert defaults["enabled"] is True
        assert defaults["severity"] == {"E": "Error"}

    def test_global_settings_override_tool_defaults(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_settings={"enabled": True},
        )
        ts = _make_server(cfg)
        ts.global_settings["enabled"] = False
        defaults = ts.get_global_defaults()
        assert defaults["enabled"] is False

    def test_notification_level_from_config(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_notification_level="onError",
        )
        ts = _make_server(cfg)
        defaults = ts.get_global_defaults()
        assert defaults["showNotifications"] == "onError"

    def test_nested_dict_default_preserved(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_settings={"severity": {"E": "Error", "W": "Warning"}},
        )
        ts = _make_server(cfg)
        defaults = ts.get_global_defaults()
        assert defaults["severity"]["E"] == "Error"
        assert defaults["severity"]["W"] == "Warning"

    def test_global_overrides_nested_dict(self):
        cfg = ToolServerConfig(
            tool_module="flake8",
            tool_display="Flake8",
            default_settings={"severity": {"E": "Error"}},
        )
        ts = _make_server(cfg)
        ts.global_settings["severity"] = {"E": "Warning"}
        defaults = ts.get_global_defaults()
        assert defaults["severity"]["E"] == "Warning"


class TestUpdateWorkspaceSettings:
    @patch("vscode_common_python_lsp.server.uris")
    def test_empty_settings_uses_cwd(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        ts = _make_server()
        ts.update_workspace_settings(None)

        assert len(ts.workspace_settings) == 1
        settings = list(ts.workspace_settings.values())[0]
        assert "cwd" in settings
        assert "workspaceFS" in settings
        assert "interpreter" in settings

    @patch("vscode_common_python_lsp.server.uris")
    def test_multiple_workspaces(self, mock_uris):
        mock_uris.to_fs_path.side_effect = lambda u: u.replace("file://", "")
        ts = _make_server()
        ts.update_workspace_settings(
            [
                {"workspace": "file:///ws1", "args": []},
                {"workspace": "file:///ws2", "args": ["--strict"]},
            ]
        )
        assert len(ts.workspace_settings) == 2

    @patch("vscode_common_python_lsp.server.uris")
    def test_empty_list_treated_as_none(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        ts = _make_server()
        ts.update_workspace_settings([])
        assert len(ts.workspace_settings) == 1

    @patch("vscode_common_python_lsp.server.uris")
    def test_workspace_settings_include_original_keys(self, mock_uris):
        mock_uris.to_fs_path.side_effect = lambda u: u.replace("file://", "")
        ts = _make_server()
        ts.update_workspace_settings(
            [{"workspace": "file:///ws1", "args": ["--check"], "enabled": True}]
        )
        settings = list(ts.workspace_settings.values())[0]
        assert settings["args"] == ["--check"]
        assert settings["enabled"] is True

    @patch("vscode_common_python_lsp.server.uris")
    def test_multi_workspace_settings_include_defaults(self, mock_uris):
        mock_uris.to_fs_path.side_effect = lambda u: u.replace("file://", "")
        ts = _make_server()
        ts.update_workspace_settings(
            [{"workspace": "file:///ws1"}, {"workspace": "file:///ws2"}]
        )
        for ws_settings in ts.workspace_settings.values():
            assert "interpreter" in ws_settings
            assert "path" in ws_settings
            assert "args" in ws_settings
            assert "importStrategy" in ws_settings


class TestGetSettingsByPath:
    def test_matches_closest_workspace(self):
        ts = _make_server()
        ts.workspace_settings = {
            "/ws1": {"workspaceFS": "/ws1", "cwd": "/ws1"},
            "/ws2": {"workspaceFS": "/ws2", "cwd": "/ws2"},
        }
        result = ts.get_settings_by_path(pathlib.Path("/ws1/subdir/file.py"))
        assert result["workspaceFS"] == "/ws1"

    def test_file_outside_all_workspaces_returns_first(self):
        ts = _make_server()
        ts.workspace_settings = {
            "/ws1": {"workspaceFS": "/ws1"},
        }
        result = ts.get_settings_by_path(pathlib.Path("/other/file.py"))
        assert result["workspaceFS"] == "/ws1"

    def test_deeply_nested_file(self):
        ts = _make_server()
        ts.workspace_settings = {
            "/ws": {"workspaceFS": "/ws", "cwd": "/ws"},
        }
        result = ts.get_settings_by_path(pathlib.Path("/ws/a/b/c/d/file.py"))
        assert result["workspaceFS"] == "/ws"

    @patch("vscode_common_python_lsp.server.uris")
    def test_empty_workspace_settings_returns_fallback(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        ts = _make_server()
        result = ts.get_settings_by_path(pathlib.Path("/some/file.py"))
        assert "workspaceFS" in result
        assert "interpreter" in result


class TestGetSettingsByDocument:
    @patch("vscode_common_python_lsp.server.uris")
    def test_none_document_returns_first(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///ws"
        ts = _make_server()
        ts.update_workspace_settings(None)
        settings = ts.get_settings_by_document(None)
        assert "workspaceFS" in settings

    @patch("vscode_common_python_lsp.server.uris")
    def test_document_with_no_path(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///ws"
        ts = _make_server()
        ts.update_workspace_settings(None)
        doc = MagicMock()
        doc.path = None
        settings = ts.get_settings_by_document(doc)
        assert "workspaceFS" in settings

    @patch("vscode_common_python_lsp.server.uris")
    def test_none_document_empty_workspace_settings(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        ts = _make_server()
        result = ts.get_settings_by_document(None)
        assert "workspaceFS" in result
        assert "interpreter" in result

    @patch("vscode_common_python_lsp.server.uris")
    def test_no_path_document_empty_workspace_settings(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        ts = _make_server()
        doc = MagicMock()
        doc.path = None
        result = ts.get_settings_by_document(doc)
        assert "workspaceFS" in result
        assert "interpreter" in result

    def test_document_in_known_workspace(self):
        ts = _make_server()
        from vscode_common_python_lsp.paths import normalize_path

        ws1_key = normalize_path(os.path.abspath("/ws1"))
        ws2_key = normalize_path(os.path.abspath("/ws2"))
        ts.workspace_settings = {
            ws1_key: {"workspaceFS": ws1_key, "cwd": ws1_key},
            ws2_key: {"workspaceFS": ws2_key, "cwd": ws2_key},
        }
        doc_path = os.path.join(os.path.abspath("/ws1"), "src", "file.py")
        doc = _make_document(doc_path)
        result = ts.get_settings_by_document(doc)
        assert result["workspaceFS"] == ws1_key

    @patch("vscode_common_python_lsp.server.uris")
    def test_document_outside_workspaces_creates_fallback(self, mock_uris):
        mock_uris.from_fs_path.return_value = "file:///other/src"
        ts = _make_server()
        ts.workspace_settings = {
            "/ws1": {"workspaceFS": "/ws1"},
        }
        doc = _make_document("/other/src/file.py")
        result = ts.get_settings_by_document(doc)
        assert "workspaceFS" in result
        assert "interpreter" in result


class TestGetDocumentKey:
    def test_returns_none_when_no_workspace(self):
        ts = _make_server()
        doc = _make_document()
        assert ts.get_document_key(doc) is None

    def test_returns_matching_workspace_key(self):
        ts = _make_server()
        from vscode_common_python_lsp.paths import normalize_path

        ws1_key = normalize_path(os.path.abspath("/ws1"))
        ws2_key = normalize_path(os.path.abspath("/ws2"))
        ts.workspace_settings = {
            ws1_key: {"workspaceFS": ws1_key},
            ws2_key: {"workspaceFS": ws2_key},
        }
        doc_path = os.path.join(os.path.abspath("/ws1"), "src", "file.py")
        doc = _make_document(doc_path)
        assert ts.get_document_key(doc) == ws1_key

    def test_returns_none_when_document_outside_all(self):
        ts = _make_server()
        ts.workspace_settings = {
            "/ws1": {"workspaceFS": "/ws1"},
        }
        doc = _make_document("/other/file.py")
        assert ts.get_document_key(doc) is None


class TestResolveSymlinks:
    """Tests for the resolve_symlinks config propagation to normalize_path."""

    def test_default_config_has_resolve_symlinks_false(self):
        cfg = ToolServerConfig(tool_module="mod", tool_display="Mod")
        assert cfg.resolve_symlinks is False

    @patch("vscode_common_python_lsp.server.normalize_path")
    @patch("vscode_common_python_lsp.server.uris")
    def test_update_workspace_settings_passes_resolve_symlinks_false(
        self, mock_uris, mock_normalize
    ):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        mock_normalize.return_value = "/normalized/cwd"
        ts = _make_server()
        ts.update_workspace_settings(None)
        mock_normalize.assert_called_with(os.getcwd(), resolve_symlinks=False)

    @patch("vscode_common_python_lsp.server.normalize_path")
    @patch("vscode_common_python_lsp.server.uris")
    def test_update_workspace_settings_passes_resolve_symlinks_true(
        self, mock_uris, mock_normalize
    ):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        mock_normalize.return_value = "/normalized/cwd"
        cfg = ToolServerConfig(
            tool_module="mod", tool_display="Mod", resolve_symlinks=True
        )
        ts = _make_server(cfg)
        ts.update_workspace_settings(None)
        mock_normalize.assert_called_with(os.getcwd(), resolve_symlinks=True)

    @patch("vscode_common_python_lsp.server.normalize_path")
    @patch("vscode_common_python_lsp.server.uris")
    def test_update_workspace_settings_list_passes_resolve_symlinks(
        self, mock_uris, mock_normalize
    ):
        mock_uris.to_fs_path.side_effect = lambda u: u.replace("file://", "")
        mock_normalize.return_value = "/ws1"
        ts = _make_server()
        ts.update_workspace_settings([{"workspace": "file:///ws1"}])
        mock_normalize.assert_called_with("/ws1", resolve_symlinks=False)

    @patch("vscode_common_python_lsp.server.normalize_path")
    @patch("vscode_common_python_lsp.server.uris")
    def test_get_settings_by_document_passes_resolve_symlinks(
        self, mock_uris, mock_normalize
    ):
        mock_uris.from_fs_path.return_value = "file:///parent"
        mock_normalize.return_value = "/parent"
        ts = _make_server()
        doc = _make_document("/parent/file.py")
        # No workspace settings, document outside all → fallback path
        ts.get_settings_by_document(doc)
        mock_normalize.assert_called_with(
            str(pathlib.Path("/parent/file.py").parent),
            resolve_symlinks=False,
        )

    @patch("vscode_common_python_lsp.server.normalize_path")
    @patch("vscode_common_python_lsp.server.uris")
    def test_get_settings_by_path_empty_passes_resolve_symlinks(
        self, mock_uris, mock_normalize
    ):
        mock_uris.from_fs_path.return_value = "file:///cwd"
        mock_normalize.return_value = "/normalized/cwd"
        ts = _make_server()
        ts.get_settings_by_path(pathlib.Path("/some/file.py"))
        mock_normalize.assert_called_with(os.getcwd(), resolve_symlinks=False)


# ---------------------------------------------------------------------------
# CWD resolution
# ---------------------------------------------------------------------------


class TestGetCwd:
    def test_default_cwd_is_workspace(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace"}
        assert ts.get_cwd(settings) == "/workspace"

    def test_explicit_cwd_setting(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": "/custom"}
        assert ts.get_cwd(settings) == "/custom"

    def test_file_variable_substitution(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": "${fileDirname}"}
        doc = _make_document("/workspace/src/main.py")
        result = ts.get_cwd(settings, doc)
        expected = os.path.dirname("/workspace/src/main.py")
        assert result == expected

    def test_document_path_override(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": "${file}"}
        doc = _make_document("/workspace/notebook.ipynb")
        result = ts.get_cwd(settings, doc, document_path="/workspace/cell.py")
        assert result == "/workspace/cell.py"

    def test_unresolvable_variable_falls_back(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": "${file}"}
        result = ts.get_cwd(settings)
        assert result == "/workspace"

    def test_relative_file_variable_falls_back_without_doc(self):
        ts = _make_server()
        for token in ["${relativeFile}", "${relativeFileDirname}"]:
            settings = {"workspaceFS": "/workspace", "cwd": token}
            result = ts.get_cwd(settings, None)
            assert result == "/workspace", f"Failed for {token}"

    @pytest.mark.parametrize(
        "var,expected",
        [
            ("${file}", "/workspace/src/foo.py"),
            ("${fileBasename}", "foo.py"),
            ("${fileBasenameNoExtension}", "foo"),
            ("${fileExtname}", ".py"),
            ("${fileDirname}", "/workspace/src"),
            ("${fileDirnameBasename}", "src"),
            ("${relativeFile}", os.path.relpath("/workspace/src/foo.py", "/workspace")),
            (
                "${relativeFileDirname}",
                os.path.relpath("/workspace/src", "/workspace"),
            ),
            ("${fileWorkspaceFolder}", "/workspace"),
        ],
    )
    def test_all_file_variables_exact(self, var, expected):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": var}
        doc = _make_document("/workspace/src/foo.py")
        assert ts.get_cwd(settings, doc) == expected

    def test_document_path_takes_precedence_over_doc(self):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": "${fileDirname}"}
        doc = _make_document("/workspace/original.py")
        result = ts.get_cwd(settings, doc, document_path="/workspace/override/cell.py")
        assert result == "/workspace/override"


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------


class TestExecuteTool:
    def test_path_mode(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_path") as mock_run:
            mock_run.return_value = MagicMock(stdout="ok", stderr="")
            result = ts.execute_tool(
                argv=["/usr/bin/tool", "--check"],
                mode="path",
                settings={},
                cwd="/tmp",
            )
            mock_run.assert_called_once()
            assert result.stdout == "ok"

    def test_path_mode_logs_argv_and_cwd(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_path") as mock_run:
            mock_run.return_value = MagicMock(stdout="", stderr="")
            ts.execute_tool(
                argv=["/bin/tool", "--flag"],
                mode="path",
                settings={},
                cwd="/tmp",
            )
        calls = ts.server.window_log_message.call_args_list
        messages = [str(c) for c in calls]
        assert any("--flag" in m for m in messages)
        assert any("CWD Server: /tmp" in m for m in messages)

    def test_path_mode_logs_stderr(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_path") as mock_run:
            mock_run.return_value = MagicMock(stdout="ok", stderr="some warning")
            ts.execute_tool(
                argv=["/bin/tool"],
                mode="path",
                settings={},
                cwd="/tmp",
            )
        messages = [str(c) for c in ts.server.window_log_message.call_args_list]
        assert any("some warning" in m for m in messages)

    def test_path_mode_passes_use_stdin_and_source(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_path") as mock_run:
            mock_run.return_value = MagicMock(stdout="", stderr="")
            ts.execute_tool(
                argv=["/bin/tool"],
                mode="path",
                settings={},
                cwd="/tmp",
                use_stdin=True,
                source="print('hello')",
            )
        call_kwargs = mock_run.call_args[1]
        assert call_kwargs["use_stdin"] is True
        assert call_kwargs["source"] == "print('hello')"

    def test_path_mode_forwards_env_and_timeout(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_path") as mock_run:
            mock_run.return_value = MagicMock(stdout="", stderr="")
            custom_env = {"MY_VAR": "value"}
            ts.execute_tool(
                argv=["/bin/tool"],
                mode="path",
                settings={},
                cwd="/tmp",
                env=custom_env,
                timeout=30.0,
            )
        call_kwargs = mock_run.call_args[1]
        assert call_kwargs["env"] == custom_env
        assert call_kwargs["timeout"] == 30.0

    def test_rpc_mode(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.run_over_json_rpc"
        ) as mock_rpc:
            mock_rpc.return_value = MagicMock(
                stdout="rpc_out", stderr="", exception=None
            )
            result = ts.execute_tool(
                argv=["testtool", "--check"],
                mode="rpc",
                settings={"interpreter": ["python3"]},
                cwd="/tmp",
                workspace="/ws",
            )
            mock_rpc.assert_called_once()
            call_kwargs = mock_rpc.call_args[1]
            assert call_kwargs["module"] == "testtool"
            assert call_kwargs["runner_script"] == "/path/to/runner.py"
            assert result.stdout == "rpc_out"

    def test_rpc_mode_with_env_and_timeout(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.run_over_json_rpc"
        ) as mock_rpc:
            mock_rpc.return_value = MagicMock(stdout="", stderr="", exception=None)
            ts.execute_tool(
                argv=["testtool"],
                mode="rpc",
                settings={"interpreter": ["python3"]},
                cwd="/tmp",
                workspace="/ws",
                env={"EXTRA": "val"},
                timeout=5.0,
            )
            call_kwargs = mock_rpc.call_args[1]
            assert call_kwargs["env"] == {"EXTRA": "val"}
            assert call_kwargs["timeout"] == 5.0

    def test_rpc_mode_uses_tool_module_from_config(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.run_over_json_rpc"
        ) as mock_rpc:
            mock_rpc.return_value = MagicMock(stdout="", stderr="", exception=None)
            ts.execute_tool(
                argv=["--check"],
                mode="rpc",
                settings={"interpreter": ["python3"]},
                cwd="/tmp",
                workspace="/ws",
            )
        assert mock_rpc.call_args[1]["module"] == "testtool"

    def test_module_mode(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_module") as mock_run:
            mock_run.return_value = MagicMock(stdout="mod_out", stderr="")
            result = ts.execute_tool(
                argv=["testtool", "--check"],
                mode="module",
                settings={},
                cwd="/tmp",
            )
            mock_run.assert_called_once()
            assert result.stdout == "mod_out"

    def test_module_mode_logs_exception(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_module") as mock_run:
            mock_run.side_effect = RuntimeError("boom")
            with pytest.raises(RuntimeError, match="boom"):
                ts.execute_tool(
                    argv=["testtool"],
                    mode="module",
                    settings={},
                    cwd="/tmp",
                )
            ts.server.window_log_message.assert_called()

    def test_module_mode_logs_stderr(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.run_module") as mock_run:
            mock_run.return_value = MagicMock(stdout="ok", stderr="module warning")
            ts.execute_tool(
                argv=["testtool"],
                mode="module",
                settings={},
                cwd="/tmp",
            )
        messages = [str(c) for c in ts.server.window_log_message.call_args_list]
        assert any("module warning" in m for m in messages)

    def test_runner_script_override(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.run_over_json_rpc"
        ) as mock_rpc:
            mock_rpc.return_value = MagicMock(stdout="", stderr="", exception=None)
            ts.execute_tool(
                argv=["testtool"],
                mode="rpc",
                settings={"interpreter": ["python3"]},
                cwd="/tmp",
                workspace="/ws",
                runner_script="/custom/runner.py",
            )
            call_kwargs = mock_rpc.call_args[1]
            assert call_kwargs["runner_script"] == "/custom/runner.py"


class TestRpcToRunResult:
    def test_exception_logged_as_error(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="err", exception="traceback")
        result = ts._rpc_to_run_result(rpc_result)
        assert result.stdout == "out"
        assert result.stderr == "traceback\nerr"
        ts.server.window_log_message.assert_called()

    def test_exception_and_stderr_combined(self):
        ts = _make_server()
        rpc_result = MagicMock(
            stdout="out", stderr="diagnostic info", exception="fatal error"
        )
        result = ts._rpc_to_run_result(rpc_result)
        assert "fatal error" in result.stderr
        assert "diagnostic info" in result.stderr

    def test_exception_without_stderr(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="", exception="traceback")
        result = ts._rpc_to_run_result(rpc_result)
        assert result.stderr == "traceback"

    def test_stderr_logged_to_output(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="warning text", exception=None)
        result = ts._rpc_to_run_result(rpc_result)
        assert result.stderr == "warning text"
        ts.server.window_log_message.assert_called()

    def test_clean_result(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="", exception=None)
        result = ts._rpc_to_run_result(rpc_result)
        assert result.stdout == "out"
        assert result.stderr == ""


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


class TestLogging:
    def test_log_to_output(self):
        ts = _make_server()
        ts.log_to_output("hello")
        ts.server.window_log_message.assert_called_once()

    def test_log_error_shows_notification_when_enabled(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "onError"}):
            ts.log_error("bad thing")
        ts.server.window_show_message.assert_called_once()

    def test_log_error_no_notification_when_off(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "off"}):
            ts.log_error("bad thing")
        ts.server.window_show_message.assert_not_called()

    def test_log_warning_shows_notification_when_enabled(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "onWarning"}):
            ts.log_warning("caution")
        ts.server.window_show_message.assert_called_once()

    def test_log_warning_no_notification_on_error_level(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "onError"}):
            ts.log_warning("caution")
        ts.server.window_show_message.assert_not_called()

    @pytest.mark.parametrize("level", ["onWarning", "always"])
    def test_log_warning_notification_levels(self, level):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": level}):
            ts.log_warning("msg")
        ts.server.window_show_message.assert_called_once()

    @pytest.mark.parametrize("level", ["onError", "onWarning", "always"])
    def test_log_error_notification_levels(self, level):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": level}):
            ts.log_error("msg")
        ts.server.window_show_message.assert_called_once()

    def test_log_always_shows_notification_when_always(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "always"}):
            ts.log_always("info")
        ts.server.window_show_message.assert_called_once()

    @pytest.mark.parametrize("level", ["off", "onError", "onWarning"])
    def test_log_always_no_notification_unless_always(self, level):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": level}):
            ts.log_always("info")
        ts.server.window_show_message.assert_not_called()

    def test_log_always_logs_to_output(self):
        ts = _make_server()
        with patch.dict(os.environ, {"LS_SHOW_NOTIFICATION": "off"}):
            ts.log_always("info msg")
        ts.server.window_log_message.assert_called_once()


# ---------------------------------------------------------------------------
# Lifecycle helpers
# ---------------------------------------------------------------------------


class TestLifecycle:
    def test_apply_settings(self):
        ts = _make_server()
        params = MagicMock()
        params.initialization_options = {
            "globalSettings": {"path": ["/tool"]},
            "settings": None,
        }
        ts.apply_settings(params)
        assert ts.global_settings["path"] == ["/tool"]
        assert len(ts.workspace_settings) > 0

    def test_apply_settings_with_workspaces(self):
        ts = _make_server()
        with patch("vscode_common_python_lsp.server.uris") as mock_uris:
            mock_uris.to_fs_path.side_effect = lambda u: u.replace("file://", "")
            params = MagicMock()
            params.initialization_options = {
                "globalSettings": {},
                "settings": [
                    {"workspace": "file:///ws1"},
                    {"workspace": "file:///ws2"},
                ],
            }
            ts.apply_settings(params)
            assert len(ts.workspace_settings) == 2

    def test_apply_settings_updates_global_settings(self):
        ts = _make_server()
        params = MagicMock()
        params.initialization_options = {
            "globalSettings": {"path": ["/first"]},
            "settings": None,
        }
        ts.apply_settings(params)
        assert ts.global_settings["path"] == ["/first"]

        params.initialization_options = {
            "globalSettings": {"path": ["/second"]},
            "settings": None,
        }
        ts.apply_settings(params)
        assert ts.global_settings["path"] == ["/second"]

    def test_log_startup_info(self):
        ts = _make_server()
        ts.global_settings = {"path": []}
        ts.log_startup_info(settings=[{"workspace": "file:///ws"}])
        assert ts.server.window_log_message.call_count >= 3

    def test_log_startup_info_without_settings(self):
        ts = _make_server()
        ts.global_settings = {"path": []}
        ts.log_startup_info()
        # Should still log CWD, global settings, sys.path
        assert ts.server.window_log_message.call_count >= 2

    def test_handle_exit(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.shutdown_json_rpc"
        ) as mock_shutdown:
            ts.handle_exit()
            mock_shutdown.assert_called_once()

    def test_handle_shutdown(self):
        ts = _make_server()
        with patch(
            "vscode_common_python_lsp.server.jsonrpc.shutdown_json_rpc"
        ) as mock_shutdown:
            ts.handle_shutdown()
            mock_shutdown.assert_called_once()

    def test_apply_settings_with_none_initialization_options(self):
        ts = _make_server()
        params = MagicMock()
        params.initialization_options = None
        ts.apply_settings(params)
        assert ts.global_settings == {}

    def test_apply_settings_without_settings_key(self):
        ts = _make_server()
        params = MagicMock()
        params.initialization_options = {
            "globalSettings": {"path": ["/tool"]},
        }
        ts.apply_settings(params)
        assert ts.global_settings["path"] == ["/tool"]

    def test_execute_tool_invalid_mode_raises(self):
        ts = _make_server()
        with pytest.raises(ValueError, match="Unknown execution mode"):
            ts.execute_tool(
                argv=["testtool"],
                mode="invalid",
                settings={},
                cwd="/tmp",
            )

    def test_execute_tool_rpc_requires_workspace(self):
        ts = _make_server()
        with pytest.raises(ValueError, match="workspace is required"):
            ts.execute_tool(
                argv=["testtool"],
                mode="rpc",
                settings={"interpreter": ["python3"]},
                cwd="/tmp",
            )

    def test_get_cwd_different_drives_no_crash(self):
        """relativeFile/relativeFileDirname don't crash on different drives."""
        ts = _make_server()
        settings = {"workspaceFS": "C:\\workspace", "cwd": "${relativeFile}"}
        doc = _make_document("D:\\other\\file.py")
        # Should not raise ValueError, should fall back gracefully
        result = ts.get_cwd(settings, doc)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


class TestToolServerInit:
    def test_creates_default_server(self):
        with (
            patch("vscode_common_python_lsp.server.LanguageServer") as mock_cls,
            patch(
                "vscode_common_python_lsp.server.importlib.metadata.version",
                return_value="1.2.3",
            ),
        ):
            mock_cls.return_value = MagicMock()
            ts = ToolServer(BASIC_CONFIG)
            mock_cls.assert_called_once_with(
                name="testtool-server",
                version="v1.2.3",
                max_workers=5,
            )
            assert ts.server is mock_cls.return_value

    def test_fallback_version_when_package_not_installed(self):
        with (
            patch("vscode_common_python_lsp.server.LanguageServer") as mock_cls,
            patch(
                "vscode_common_python_lsp.server.importlib.metadata.version",
                side_effect=importlib.metadata.PackageNotFoundError(
                    "vscode-common-python-lsp"
                ),
            ),
        ):
            mock_cls.return_value = MagicMock()
            ToolServer(BASIC_CONFIG)
            mock_cls.assert_called_once_with(
                name="testtool-server",
                version="v0.0.0-dev",
                max_workers=5,
            )

    def test_accepts_custom_server(self):
        custom = MagicMock()
        ts = ToolServer(BASIC_CONFIG, server=custom)
        assert ts.server is custom

    def test_empty_initial_state(self):
        ts = _make_server()
        assert ts.workspace_settings == {}
        assert ts.global_settings == {}


if __name__ == "__main__":
    unittest.main()
