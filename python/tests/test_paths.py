# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for paths module."""

import os
import sys

import pytest

from vscode_common_python_lsp.paths import (
    as_list,
    get_relative_path,
    is_current_interpreter,
    is_match,
    is_same_path,
    is_stdlib_file,
    normalize_path,
)


class TestAsList:
    def test_list_input(self):
        assert as_list([1, 2, 3]) == [1, 2, 3]

    def test_tuple_input(self):
        assert as_list((1, 2)) == [1, 2]

    def test_single_value(self):
        assert as_list(42) == [42]

    def test_string_value(self):
        assert as_list("hello") == ["hello"]

    def test_none_value(self):
        assert as_list(None) == [None]


class TestNormalizePath:
    def test_returns_absolute(self):
        result = normalize_path(".")
        assert os.path.isabs(result)

    def test_without_symlink_resolve(self):
        result = normalize_path("some/path", resolve_symlinks=False)
        assert isinstance(result, str)


class TestIsSamePath:
    def test_same_path(self, tmp_path):
        p = str(tmp_path / "file.txt")
        assert is_same_path(p, p)

    def test_different_paths(self, tmp_path):
        assert not is_same_path(str(tmp_path / "a"), str(tmp_path / "b"))


class TestIsCurrentInterpreter:
    def test_current_executable(self):
        assert is_current_interpreter(sys.executable)

    def test_different_executable(self):
        assert not is_current_interpreter("/nonexistent/python")


class TestIsStdlibFile:
    def test_stdlib_module(self):
        import json

        assert is_stdlib_file(json.__file__)

    def test_non_stdlib_file(self, tmp_path):
        assert not is_stdlib_file(str(tmp_path / "test.py"))


class TestGetRelativePath:
    def test_relative_to_workspace(self, tmp_path):
        fp = str(tmp_path / "src" / "test.py")
        result = get_relative_path(fp, str(tmp_path))
        assert result == "src/test.py"

    def test_empty_workspace_root(self):
        result = get_relative_path("/some/path/file.py", "")
        assert isinstance(result, str)


class TestIsMatch:
    def test_empty_patterns(self):
        assert not is_match([], "test.py")

    def test_matching_pattern(self):
        assert is_match(["*.py"], "test.py")

    def test_non_matching_pattern(self):
        assert not is_match(["*.js"], "test.py")

    def test_with_workspace_root(self, tmp_path):
        fp = str(tmp_path / "src" / "test.py")
        assert is_match(["src/*.py"], fp, str(tmp_path))

    def test_filename_match_without_slash(self):
        assert is_match(["test.py"], "/some/path/test.py")
