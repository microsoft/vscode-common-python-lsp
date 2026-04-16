# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.debug."""

import os
from unittest.mock import MagicMock, patch

import pytest

from vscode_common_python_lsp.debug import setup_debugpy


def test_no_env_var_does_nothing():
    """When USE_DEBUGPY is not set, debugpy is not loaded."""
    with patch.dict(os.environ, {}, clear=True):
        os.environ.pop("USE_DEBUGPY", None)
        os.environ.pop("DEBUGPY_PATH", None)
        setup_debugpy()


@pytest.mark.parametrize("value", ["False", "false", "0", "no", ""])
def test_disabled_values_do_nothing(value):
    """Non-truthy USE_DEBUGPY values skip debugpy setup."""
    with patch.dict(os.environ, {"USE_DEBUGPY": value}, clear=False):
        setup_debugpy()


@pytest.mark.parametrize("value", ["True", "TRUE", "1", "T"])
def test_enabled_without_path_does_nothing(value):
    """USE_DEBUGPY enabled but no DEBUGPY_PATH skips setup."""
    env = {"USE_DEBUGPY": value}
    with patch.dict(os.environ, env, clear=False):
        os.environ.pop("DEBUGPY_PATH", None)
        setup_debugpy()


def test_enabled_with_path_connects():
    """USE_DEBUGPY + DEBUGPY_PATH triggers debugpy.connect."""
    mock_debugpy = MagicMock()
    debugger_dir = os.path.dirname(__file__)
    env = {"USE_DEBUGPY": "True", "DEBUGPY_PATH": debugger_dir}
    with patch.dict(os.environ, env, clear=False):
        with patch.dict("sys.modules", {"debugpy": mock_debugpy}):
            with patch(
                "vscode_common_python_lsp.debug._update_sys_path"
            ) as mock_update:
                setup_debugpy(port=9999)

                mock_update.assert_called_once_with(debugger_dir)
                mock_debugpy.connect.assert_called_once_with(9999)
                mock_debugpy.breakpoint.assert_called_once()


def test_debugpy_path_ending_with_debugpy_strips_suffix():
    """DEBUGPY_PATH ending with 'debugpy' uses parent directory."""
    test_parent = os.path.dirname(__file__)
    debugpy_path = os.path.join(test_parent, "debugpy")
    env = {"USE_DEBUGPY": "True", "DEBUGPY_PATH": debugpy_path}

    mock_debugpy = MagicMock()
    with patch.dict(os.environ, env, clear=False):
        with patch.dict("sys.modules", {"debugpy": mock_debugpy}):
            with patch(
                "vscode_common_python_lsp.debug._update_sys_path"
            ) as mock_update:
                setup_debugpy()
                mock_update.assert_called_once_with(test_parent)


# ---------------------------------------------------------------------------
# require_opt_in=False tests (for repos without USE_DEBUGPY guard)
# ---------------------------------------------------------------------------


def test_no_opt_in_skips_use_debugpy_check():
    """With require_opt_in=False, USE_DEBUGPY is not checked."""
    mock_debugpy = MagicMock()
    debugger_dir = os.path.dirname(__file__)
    env = {"DEBUGPY_PATH": debugger_dir}
    with patch.dict(os.environ, env, clear=True):
        with patch.dict("sys.modules", {"debugpy": mock_debugpy}):
            with patch("vscode_common_python_lsp.debug._update_sys_path"):
                setup_debugpy(require_opt_in=False)

                mock_debugpy.connect.assert_called_once_with(5678)
                mock_debugpy.breakpoint.assert_called_once()


def test_no_opt_in_still_requires_debugpy_path():
    """With require_opt_in=False but no DEBUGPY_PATH, nothing happens."""
    with patch.dict(os.environ, {}, clear=True):
        setup_debugpy(require_opt_in=False)


@pytest.mark.parametrize("value", ["False", "0", "no"])
def test_no_opt_in_ignores_use_debugpy_value(value):
    """With require_opt_in=False, USE_DEBUGPY value is irrelevant."""
    mock_debugpy = MagicMock()
    debugger_dir = os.path.dirname(__file__)
    env = {"USE_DEBUGPY": value, "DEBUGPY_PATH": debugger_dir}
    with patch.dict(os.environ, env, clear=False):
        with patch.dict("sys.modules", {"debugpy": mock_debugpy}):
            with patch("vscode_common_python_lsp.debug._update_sys_path"):
                setup_debugpy(require_opt_in=False)

                mock_debugpy.connect.assert_called_once()
