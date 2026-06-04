# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for paths module."""

import os
import pathlib
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
    safe_fs_path,
    sanitize_path_for_name_max,
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
    @pytest.mark.parametrize(
        "path, expected",
        [
            (sys.executable, True),
            ("/nonexistent/python", False),
        ],
    )
    def test_is_current_interpreter(self, path, expected):
        assert is_current_interpreter(path) == expected


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


# ---------------------------------------------------------------------------
# safe_fs_path tests
# ---------------------------------------------------------------------------

# A realistic dev-container/tunnel netloc component (>255 chars).
_LONG_NETLOC = (
    "dev-container+7b22686f737450617468223a222f686f6d652f646f6e6e79"
    "2f50726f6a656374732f776f72647365617263682d637370222c226c6f63"
    "616c446f636b6572223a66616c73652c22636f6e66696746696c65223a7b"
    "22246d6964223a312c2270617468223a222f686f6d652f646f6e6e792f50"
    "726f6a656374732f776f72647365617263682d6373702f2e646576636f6e"
    "7461696e65722f646576636f6e7461696e65722e6a736f6e222c22736368"
    "656d65223a227673636f64652d66696c65486f7374227d7d"
)


class TestSafeFsPath:
    """Tests for safe_fs_path() — dev-container/tunnel path sanitisation."""

    def test_short_path_unchanged(self):
        """Normal paths should pass through untouched."""
        p = os.path.join(os.sep, "home", "user", "project", "src", "main.py")
        assert safe_fs_path(p) == p

    def test_overlong_component_detected(self):
        """The fixture netloc must actually exceed NAME_MAX."""
        assert len(_LONG_NETLOC.encode()) > 255

    def test_overlong_without_workspace(self):
        """Overlong component is replaced with '_', basename preserved."""
        p = os.path.join(os.sep, _LONG_NETLOC, "workspace", "src", "main.py")
        result = safe_fs_path(p)
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255
        assert result.endswith("main.py")

    def test_overlong_with_workspace(self):
        """With a workspace, result preserves sub-path below overlong component."""
        p = os.path.join(os.sep, _LONG_NETLOC, "workspace", "src", "main.py")
        workspace = os.path.join(os.sep, "workspace")
        result = safe_fs_path(p, workspace=workspace)
        assert result == os.path.join(workspace, "workspace", "src", "main.py")

    def test_overlong_with_workspace_preserves_subpath(self):
        """Sub-path below overlong component is preserved when re-rooting."""
        p = os.path.join(os.sep, _LONG_NETLOC, "deep", "nested", "path", "app.py")
        workspace = os.path.join(os.sep, "home", "user", "project")
        result = safe_fs_path(p, workspace=workspace)
        assert result == os.path.join(workspace, "deep", "nested", "path", "app.py")

    def test_multiple_overlong_components(self):
        """Multiple overlong components are all sanitised."""
        long1 = "a" * 300
        long2 = "b" * 400
        p = os.path.join(os.sep, long1, long2, "file.py")
        result = safe_fs_path(p)
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255

    def test_empty_workspace_falls_back(self):
        """Empty workspace string triggers component-replacement fallback."""
        p = os.path.join(os.sep, _LONG_NETLOC, "src", "file.py")
        result = safe_fs_path(p, workspace="")
        assert result.endswith("file.py")
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255

    def test_unicode_path_component(self):
        """Multi-byte UTF-8 components exceeding 255 bytes are sanitised."""
        # Each emoji is 4 bytes in UTF-8; 64 emojis = 256 bytes > 255
        long_unicode = "\U0001f600" * 64
        p = os.path.join(os.sep, long_unicode, "file.py")
        result = safe_fs_path(p)
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode("utf-8")) <= 255

    def test_overlong_basename_without_workspace(self):
        """Overlong basename without workspace is sanitized, preserving suffix."""
        long_name = "x" * 300 + ".py"
        p = os.path.join(os.sep, "dev", long_name)
        result = safe_fs_path(p)
        assert pathlib.PurePath(result).name == "_.py"
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255

    def test_overlong_basename_with_workspace(self):
        """Overlong basename with workspace is sanitized, preserving suffix."""
        long_name = "a" * 300 + ".py"
        p = os.path.join(os.sep, _LONG_NETLOC, "src", long_name)
        workspace = os.path.join(os.sep, "workspace")
        result = safe_fs_path(p, workspace=workspace)
        assert pathlib.PurePath(result).name == "_.py"
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255


class TestSanitizePathForNameMax:
    """Tests for sanitize_path_for_name_max() — cross-platform implementation."""

    def test_short_path_unchanged(self):
        """Normal paths should pass through untouched."""
        p = os.path.join(os.sep, "home", "user", "project", "src", "main.py")
        assert sanitize_path_for_name_max(p) == p

    def test_overlong_without_workspace(self):
        """Overlong component is replaced with '_', basename preserved."""
        p = os.path.join(os.sep, _LONG_NETLOC, "workspace", "src", "main.py")
        result = sanitize_path_for_name_max(p)
        for part in pathlib.PurePath(result).parts:
            assert len(part.encode()) <= 255
        assert result.endswith("main.py")

    def test_overlong_with_workspace(self):
        """With a workspace, result preserves sub-path below overlong component."""
        p = os.path.join(os.sep, _LONG_NETLOC, "workspace", "src", "main.py")
        workspace = os.path.join(os.sep, "workspace")
        result = sanitize_path_for_name_max(p, workspace=workspace)
        assert result == os.path.join(workspace, "workspace", "src", "main.py")

    def test_overlong_basename_replaced_preserving_suffix(self):
        """If basename itself is too long, it gets replaced preserving suffix."""
        long_name = "x" * 300 + ".py"
        p = os.path.join(os.sep, "workspace", "src", long_name)
        workspace = os.path.join(os.sep, "workspace")
        result = sanitize_path_for_name_max(p, workspace=workspace)
        # Should replace with "_.py" not reroute under workspace
        assert pathlib.PurePath(result).name == "_.py"

    def test_workspace_preserves_subpath(self):
        """Intermediate directories below overlong component are preserved."""
        p = os.path.join(os.sep, _LONG_NETLOC, "src", "pkg", "main.py")
        workspace = os.path.join(os.sep, "ws")
        result = sanitize_path_for_name_max(p, workspace=workspace)
        assert result == os.path.join(os.sep, "ws", "src", "pkg", "main.py")

    def test_workspace_with_overlong_basename_in_tail(self):
        """Workspace branch sanitizes an overlong basename in the tail."""
        long_name = "a" * 300 + ".py"
        p = os.path.join(os.sep, _LONG_NETLOC, "workspace", long_name)
        workspace = os.path.join(os.sep, "ws")
        result = sanitize_path_for_name_max(p, workspace=workspace)
        assert pathlib.PurePath(result).name == "_.py"
        assert result.startswith(workspace)

    def test_windows_limit_kind(self):
        """Windows mode uses character count, not byte count."""
        # 200 emoji chars = 200 characters but 800 UTF-8 bytes
        # Should NOT exceed on windows (200 < 255) but WOULD exceed on posix (800 > 255)
        component = "\U0001f600" * 200
        p = os.path.join(os.sep, component, "file.py")
        result_win = sanitize_path_for_name_max(p, limit_kind="windows")
        result_posix = sanitize_path_for_name_max(p, limit_kind="posix")
        # Windows: unchanged (200 chars < 255)
        assert result_win == p
        # POSIX: sanitized (800 bytes > 255)
        assert result_posix != p
        assert result_posix.endswith("file.py")

    def test_root_components_ignored(self):
        """Root/anchor parts like '/' are not flagged as overlong."""
        p = os.path.join(os.sep, "normal", "path.py")
        assert sanitize_path_for_name_max(p) == p

    def test_unicode_posix_ascii_fast_path(self):
        """ASCII-only strings that are short skip the byte-counting loop."""
        p = os.path.join(os.sep, "a" * 255, "file.py")
        # Exactly 255 is fine
        assert sanitize_path_for_name_max(p) == p
        # 256 exceeds
        p2 = os.path.join(os.sep, "a" * 256, "file.py")
        assert sanitize_path_for_name_max(p2) != p2
