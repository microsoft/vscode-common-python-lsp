# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.server."""

from __future__ import annotations

import os
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


class TestGetDocumentKey:
    def test_returns_none_when_no_workspace(self):
        ts = _make_server()
        doc = _make_document()
        assert ts.get_document_key(doc) is None


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

    @pytest.mark.parametrize(
        "var,expected_part",
        [
            ("${fileBasename}", "main.py"),
            ("${fileBasenameNoExtension}", "main"),
            ("${fileExtname}", ".py"),
            ("${fileWorkspaceFolder}", "/workspace"),
        ],
    )
    def test_all_file_variables(self, var, expected_part):
        ts = _make_server()
        settings = {"workspaceFS": "/workspace", "cwd": var}
        doc = _make_document("/workspace/src/main.py")
        result = ts.get_cwd(settings, doc)
        assert expected_part in result


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


class TestToRunResultWithLogging:
    def test_exception_logged_as_error(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="err", exception="traceback")
        result = ts.to_run_result_with_logging(rpc_result)
        assert result.stdout == "out"
        assert result.stderr == "traceback"
        # Verify error was logged
        ts.server.window_log_message.assert_called()

    def test_stderr_logged_to_output(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="warning text", exception=None)
        result = ts.to_run_result_with_logging(rpc_result)
        assert result.stderr == "warning text"

    def test_clean_result(self):
        ts = _make_server()
        rpc_result = MagicMock(stdout="out", stderr="", exception=None)
        result = ts.to_run_result_with_logging(rpc_result)
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

    def test_log_startup_info(self):
        ts = _make_server()
        ts.global_settings = {"path": []}
        ts.log_startup_info(settings=[{"workspace": "file:///ws"}])
        assert ts.server.window_log_message.call_count >= 3

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


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------


class TestToolServerInit:
    def test_creates_default_server(self):
        with patch("vscode_common_python_lsp.server.LanguageServer") as mock_cls:
            mock_cls.return_value = MagicMock()
            ts = ToolServer(BASIC_CONFIG)
            mock_cls.assert_called_once_with(
                name="testtool-server",
                version="v0.1.0",
                max_workers=5,
            )
            assert ts.server is mock_cls.return_value

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
