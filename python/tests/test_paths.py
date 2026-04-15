# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for paths module."""

import os
import site
import sys
import sysconfig
import tempfile
from unittest.mock import patch

import pytest

from vscode_common_python_lsp.paths import (
    PythonFileKind,
    as_list,
    classify_python_file,
    get_relative_path,
    is_current_interpreter,
    is_match,
    is_same_path,
    normalize_path,
)


class TestAsList:
    @pytest.mark.parametrize(
        "input_val, expected",
        [
            ([1, 2, 3], [1, 2, 3]),
            ((1, 2), [1, 2]),
            (42, [42]),
            ("hello", ["hello"]),
            (None, [None]),
        ],
    )
    def test_as_list(self, input_val, expected):
        assert as_list(input_val) == expected


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

    @pytest.mark.skipif(
        not hasattr(os, "symlink"),
        reason="os.symlink not available on this platform",
    )
    def test_symlink_without_resolve(self, tmp_path):
        """Without resolve_symlinks, symlinked paths compare as different."""
        real_dir = tmp_path / "real"
        real_dir.mkdir()
        real_file = real_dir / "test.py"
        real_file.write_text("# test", encoding="utf-8")

        link_dir = tmp_path / "link"
        try:
            link_dir.symlink_to(real_dir)
        except OSError:
            pytest.skip("Unable to create symlink (requires elevated privileges)")

        real_path = str(real_dir / "test.py")
        link_path = str(link_dir / "test.py")
        assert not is_same_path(real_path, link_path)

    @pytest.mark.skipif(
        not hasattr(os, "symlink"),
        reason="os.symlink not available on this platform",
    )
    def test_symlink_with_resolve(self, tmp_path):
        """With resolve_symlinks=True, symlinked paths compare as equal."""
        real_dir = tmp_path / "real"
        real_dir.mkdir()
        real_file = real_dir / "test.py"
        real_file.write_text("# test", encoding="utf-8")

        link_dir = tmp_path / "link"
        try:
            link_dir.symlink_to(real_dir)
        except OSError:
            pytest.skip("Unable to create symlink (requires elevated privileges)")

        real_path = str(real_dir / "test.py")
        link_path = str(link_dir / "test.py")
        assert is_same_path(real_path, link_path, resolve_symlinks=True)
        assert is_same_path(link_path, real_path, resolve_symlinks=True)

    def test_resolve_falls_back_on_oserror(self, tmp_path):
        """resolve_symlinks=True falls back to lexical when paths don't exist."""
        a = str(tmp_path / "nonexistent_a")
        b = str(tmp_path / "nonexistent_b")
        assert not is_same_path(a, b, resolve_symlinks=True)
        assert is_same_path(a, a, resolve_symlinks=True)


class TestIsCurrentInterpreter:
    def test_current_executable(self):
        assert is_current_interpreter(sys.executable)

    def test_different_executable(self):
        assert not is_current_interpreter("/nonexistent/python")


# ---------------------------------------------------------------------------
# Classifier tests (mirrors flake8 test_stdlib_detection.py)
# ---------------------------------------------------------------------------


class TestClassifyPythonFile:
    """Tests for classify_python_file() — the sole classification API."""

    def test_stdlib_module_os(self):
        """os module should be classified as STDLIB."""
        assert classify_python_file(os.__file__) == PythonFileKind.STDLIB

    def test_stdlib_module_json(self):
        """json module should be classified as STDLIB."""
        import json

        assert classify_python_file(json.__file__) == PythonFileKind.STDLIB

    def test_stdlib_module_sys(self):
        """sys module file (if it has one) should be STDLIB."""
        if hasattr(sys, "__file__") and sys.__file__:
            assert classify_python_file(sys.__file__) == PythonFileKind.STDLIB

    def test_non_python_file(self, tmp_path):
        """A user/workspace file should return None."""
        assert classify_python_file(str(tmp_path / "test.py")) is None

    def test_system_site_packages(self):
        """Files in system site-packages should be SYSTEM_SITE."""
        for site_pkg_dir in site.getsitepackages():
            test_file = os.path.join(site_pkg_dir, "pytest", "__init__.py")
            kind = classify_python_file(test_file)
            assert kind == PythonFileKind.SYSTEM_SITE, (
                f"File in site-packages {test_file} should be SYSTEM_SITE, "
                f"got {kind}"
            )

    def test_user_site_packages(self):
        """Files in user site-packages should be USER_SITE."""
        user_site = site.getusersitepackages()
        if not user_site:
            pytest.skip("User site-packages not available")
        test_file = os.path.join(user_site, "some_package", "__init__.py")
        assert classify_python_file(test_file) == PythonFileKind.USER_SITE

    def test_user_site_not_system(self):
        """User site-packages should NOT classify as SYSTEM_SITE."""
        user_site = site.getusersitepackages()
        if not user_site:
            pytest.skip("User site-packages not available")
        test_file = os.path.join(user_site, "some_package", "__init__.py")
        assert classify_python_file(test_file) != PythonFileKind.SYSTEM_SITE

    def test_system_site_not_user(self):
        """System site-packages should NOT classify as USER_SITE."""
        pkgs = site.getsitepackages()
        if not pkgs:
            pytest.skip("No system site-packages")
        test_file = os.path.join(pkgs[0], "pytest", "__init__.py")
        assert classify_python_file(test_file) != PythonFileKind.USER_SITE

    def test_site_packages_not_stdlib(self):
        """Files in site-packages should NOT be STDLIB."""
        for site_pkg_dir in site.getsitepackages():
            test_file = os.path.join(site_pkg_dir, "pytest", "__init__.py")
            assert classify_python_file(test_file) != PythonFileKind.STDLIB

    def test_user_site_packages_not_stdlib(self):
        """Files in user site-packages should NOT be STDLIB."""
        user_site = site.getusersitepackages()
        if user_site:
            test_file = os.path.join(user_site, "some_package", "__init__.py")
            assert classify_python_file(test_file) != PythonFileKind.STDLIB

    def test_random_temp_file_returns_none(self, tmp_path):
        """A temporary file should not classify as any Python kind."""
        with tempfile.NamedTemporaryFile(
            suffix=".py", dir=str(tmp_path), delete=False
        ) as tmp:
            tmp_file = tmp.name
        try:
            assert classify_python_file(tmp_file) is None
        finally:
            os.unlink(tmp_file)

    def test_site_packages_under_stdlib_excluded(self):
        """site-packages inside a stdlib root should NOT be STDLIB."""
        stdlib_path = sysconfig.get_path("stdlib")
        if not stdlib_path:
            pytest.skip("stdlib path not available")
        test_file = os.path.join(stdlib_path, "site-packages", "mod.py")
        assert classify_python_file(test_file) != PythonFileKind.STDLIB

    def test_site_packages_backup_not_excluded(self):
        """'site-packages-backup' is NOT 'site-packages' — should be STDLIB."""
        stdlib_path = sysconfig.get_path("stdlib")
        if not stdlib_path:
            pytest.skip("stdlib path not available")
        test_file = os.path.join(stdlib_path, "site-packages-backup", "mod.py")
        assert classify_python_file(test_file) == PythonFileKind.STDLIB

    def test_stdlib_is_not_none(self):
        """stdlib files should return a non-None result (library file)."""
        assert classify_python_file(os.__file__) is not None

    def test_site_packages_is_not_none(self):
        """site-packages files should return a non-None result (library file)."""
        for site_pkg_dir in site.getsitepackages():
            test_file = os.path.join(site_pkg_dir, "pytest", "__init__.py")
            assert classify_python_file(test_file) is not None

    def test_user_site_none_handling(self):
        """When user site-packages is None, should not crash."""
        with patch(
            "vscode_common_python_lsp.paths._get_user_site_root",
            return_value=None,
        ):
            assert classify_python_file("/some/random/file.py") is None


class TestGetRelativePath:
    def test_relative_to_workspace(self, tmp_path):
        fp = str(tmp_path / "src" / "test.py")
        result = get_relative_path(fp, str(tmp_path))
        assert result == "src/test.py"

    def test_empty_workspace_root(self):
        result = get_relative_path("/some/path/file.py", "")
        assert isinstance(result, str)


class TestIsMatch:
    @pytest.mark.parametrize(
        "patterns, file_path, expected",
        [
            ([], "test.py", False),
            (["*.py"], "test.py", True),
            (["*.js"], "test.py", False),
            (["test.py"], "/some/path/test.py", True),
        ],
    )
    def test_pattern_matching(self, patterns, file_path, expected):
        assert is_match(patterns, file_path) == expected

    def test_with_workspace_root(self, tmp_path):
        fp = str(tmp_path / "src" / "test.py")
        assert is_match(["src/*.py"], fp, str(tmp_path))
