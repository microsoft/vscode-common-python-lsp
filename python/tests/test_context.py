# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for context module."""

import io
import logging
import os
import sys
from unittest.mock import patch

import pytest

from vscode_common_python_lsp.context import change_cwd, redirect_io, substitute_attr


class TestSubstituteAttr:
    def test_restores_attribute(self):
        class Obj:
            value = "original"

        obj = Obj()
        with substitute_attr(obj, "value", "modified"):
            assert obj.value == "modified"
        assert obj.value == "original"

    def test_with_sys_argv(self):
        original_argv = sys.argv
        with substitute_attr(sys, "argv", ["test", "--flag"]):
            assert sys.argv == ["test", "--flag"]
        assert sys.argv is original_argv

    def test_restores_on_exception(self):
        """Attribute is restored even when the body raises."""
        original_argv = sys.argv
        with pytest.raises(RuntimeError):
            with substitute_attr(sys, "argv", ["test"]):
                raise RuntimeError("boom")
        assert sys.argv is original_argv


class TestRedirectIo:
    def test_redirect_stdout(self):
        buf = io.StringIO()
        with redirect_io("stdout", buf):
            print("hello", end="")
        assert buf.getvalue() == "hello"

    def test_restores_original(self):
        original = sys.stdout
        buf = io.StringIO()
        with redirect_io("stdout", buf):
            pass
        assert sys.stdout is original

    def test_restores_on_exception(self):
        """Stream is restored even when the body raises."""
        original = sys.stdout
        buf = io.StringIO()
        with pytest.raises(RuntimeError):
            with redirect_io("stdout", buf):
                raise RuntimeError("boom")
        assert sys.stdout is original


class TestChangeCwd:
    def test_changes_and_restores(self, tmp_path):
        original = os.getcwd()
        with change_cwd(str(tmp_path)):
            assert os.path.samefile(os.getcwd(), str(tmp_path))
        assert os.getcwd() == original

    def test_invalid_directory_does_not_raise(self):
        original = os.getcwd()
        with change_cwd("/nonexistent/path/that/does/not/exist"):
            pass  # should not raise, falls back gracefully
        assert os.getcwd() == original

    @pytest.mark.parametrize(
        "error, path, message",
        [
            (PermissionError("Access denied"), "/restricted/path", "Access denied"),
            (OSError("Some OS error"), "/inaccessible", "Some OS error"),
        ],
    )
    def test_chdir_error_logs_warning(self, caplog, error, path, message):
        """When os.chdir raises, body still runs and warning is logged."""
        original = os.getcwd()
        body_executed = False

        with patch(
            "vscode_common_python_lsp.context.os.chdir",
            side_effect=error,
        ):
            with caplog.at_level(logging.WARNING):
                with change_cwd(path):
                    body_executed = True
                    assert os.path.normcase(os.getcwd()) == os.path.normcase(original)

        assert body_executed
        assert os.path.normcase(os.getcwd()) == os.path.normcase(original)
        assert any(path in r.message for r in caplog.records)
        assert any(message in r.message for r in caplog.records)
