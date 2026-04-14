# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for context module."""

import io
import os
import sys

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
