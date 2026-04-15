# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for context module."""

import io
import logging
import os
import sys
from unittest.mock import patch

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

    def test_permission_error_logs_warning(self, caplog):
        """PermissionError on os.chdir logs warning, body still runs."""
        original = os.getcwd()
        body_executed = False

        with patch(
            "vscode_common_python_lsp.context.os.chdir",
            side_effect=PermissionError("Access denied"),
        ):
            with caplog.at_level(logging.WARNING):
                with change_cwd("/restricted/path"):
                    body_executed = True
                    assert os.path.normcase(os.getcwd()) == os.path.normcase(original)

        assert body_executed
        assert os.path.normcase(os.getcwd()) == os.path.normcase(original)
        assert any("/restricted/path" in r.message for r in caplog.records)
        assert any("Access denied" in r.message for r in caplog.records)

    def test_oserror_logs_warning(self, caplog):
        """When os.chdir raises OSError, body still runs and warning is logged."""
        original = os.getcwd()
        body_executed = False

        with patch(
            "vscode_common_python_lsp.context.os.chdir",
            side_effect=OSError("Some OS error"),
        ):
            with caplog.at_level(logging.WARNING):
                with change_cwd("/inaccessible"):
                    body_executed = True
                    assert os.path.normcase(os.getcwd()) == os.path.normcase(original)

        assert body_executed
        assert os.path.normcase(os.getcwd()) == os.path.normcase(original)
        assert any("/inaccessible" in r.message for r in caplog.records)
        assert any("Some OS error" in r.message for r in caplog.records)
