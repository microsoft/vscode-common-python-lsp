# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Path utilities for VS Code Python tool extensions."""

from __future__ import annotations

import fnmatch
import functools
import os
import pathlib
import site
import sys
import sysconfig
import threading
from enum import Enum
from typing import Any, List, Optional, Set, Tuple, Union

# Save the working directory used when loading this module
SERVER_CWD = os.getcwd()
CWD_LOCK = threading.Lock()


class PythonFileKind(Enum):
    """Classification of a Python file by its location in the environment."""

    STDLIB = "stdlib"
    USER_SITE = "user_site"
    SYSTEM_SITE = "system_site"


def as_list(content: Union[Any, List[Any], Tuple[Any]]) -> List[Any]:
    """Ensures we always get a list."""
    if isinstance(content, (list, tuple)):
        return list(content)
    return [content]


def get_sys_config_paths() -> List[str]:
    """Returns Python installation paths from sysconfig.get_paths().

    Uses the broader filter (not in data/platdata/scripts) to match
    black, isort, mypy, and pylint. Includes stdlib, platstdlib,
    purelib, platlib, include, and platinclude.
    """
    return [
        path
        for group, path in sysconfig.get_paths().items()
        if group not in ["data", "platdata", "scripts"]
    ]


def get_extensions_dir() -> List[str]:
    """Returns the VS Code extensions folder (under ~/.vscode or ~/.vscode-server).

    The path is calculated relative to this file, because users can launch
    VS Code with a custom extensions folder using the --extensions-dir argument.
    """
    path = pathlib.Path(__file__).parent.parent.parent.parent
    #                              ^     bundled  ^  extensions
    #                            tool        <extension>
    if path.name == "extensions":
        return [os.fspath(path)]
    return []


# ---------------------------------------------------------------------------
# Path classification (lazy, cached)
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def _get_stdlib_roots() -> frozenset[pathlib.Path]:
    """Resolved stdlib and platstdlib paths plus VS Code extensions dir.

    Uses only the strict stdlib/platstdlib sysconfig groups so that
    purelib/platlib (which point to site-packages) are excluded.

    The result is computed lazily on the first call, then cached for
    the lifetime of the process (paths do not change at runtime).
    """
    roots: Set[pathlib.Path] = set()
    for group in ("stdlib", "platstdlib"):
        p = sysconfig.get_path(group)
        if p:
            try:
                roots.add(pathlib.Path(p).resolve())
            except OSError:
                pass
    for p in get_extensions_dir():
        try:
            roots.add(pathlib.Path(p).resolve())
        except OSError:
            pass
    return frozenset(roots)


@functools.lru_cache(maxsize=1)
def _get_user_site_root() -> Optional[pathlib.Path]:
    """Resolved user site-packages path, or None.

    The result is computed lazily on the first call, then cached for
    the lifetime of the process.
    """
    try:
        raw = site.getusersitepackages()
    except Exception:
        return None
    if raw:
        try:
            return pathlib.Path(raw).resolve()
        except OSError:
            pass
    return None


@functools.lru_cache(maxsize=1)
def _get_system_site_roots() -> frozenset[pathlib.Path]:
    """All system site-packages roots.

    Includes purelib/platlib from sysconfig plus every entry from
    ``site.getsitepackages()``.  On Windows Store Python the latter
    includes the base installation directory, which is a *parent* of
    the stdlib root — the classifier handles this by checking stdlib
    first.

    The result is computed lazily on the first call, then cached for
    the lifetime of the process.
    """
    roots: Set[pathlib.Path] = set()
    for group in ("purelib", "platlib"):
        p = sysconfig.get_path(group)
        if p:
            try:
                roots.add(pathlib.Path(p).resolve())
            except OSError:
                pass
    try:
        for p in as_list(site.getsitepackages()):
            try:
                roots.add(pathlib.Path(p).resolve())
            except OSError:
                pass
    except Exception:
        pass
    return frozenset(roots)


def classify_python_file(file_path: str) -> Optional[PythonFileKind]:
    """Classify a file as stdlib, user site-packages, or system site-packages.

    Returns None if the file does not belong to any known Python
    installation path.  Resolution order:

    1. User site-packages (most specific user path).
    2. Stdlib roots *excluding* ``site-packages``/``dist-packages``
       subdirectories — checked before system site-packages because on
       some platforms (Windows Store Python) ``site.getsitepackages()``
       includes the base installation directory, which is a parent of
       the stdlib root.
    3. System site-packages (purelib, platlib, broad base roots).
    """
    try:
        resolved = pathlib.Path(file_path).resolve()
    except OSError:
        return None

    # 1. User site-packages (most specific)
    user_site = _get_user_site_root()
    if user_site and resolved.is_relative_to(user_site):
        return PythonFileKind.USER_SITE

    parts = resolved.parts
    has_site_packages = "site-packages" in parts or "dist-packages" in parts

    # 2. Stdlib (only if the path does NOT traverse a site-packages dir)
    if not has_site_packages:
        for root in _get_stdlib_roots():
            if resolved.is_relative_to(root):
                return PythonFileKind.STDLIB

    # 3. System site-packages (includes broad roots like the base dir)
    for root in _get_system_site_roots():
        if resolved.is_relative_to(root):
            return PythonFileKind.SYSTEM_SITE

    return None


# ---------------------------------------------------------------------------
# Path comparison and normalization
# ---------------------------------------------------------------------------


def is_same_path(
    file_path1: str, file_path2: str, resolve_symlinks: bool = False
) -> bool:
    """Returns true if two paths are the same.

    When *resolve_symlinks* is True, both paths are resolved through the
    filesystem first so that symlinked paths compare equal (mirrors the
    behaviour required by mypy).  Falls back to lexical comparison on
    OSError (e.g. the file does not exist yet).
    """
    p1, p2 = pathlib.Path(file_path1), pathlib.Path(file_path2)
    if resolve_symlinks:
        try:
            return p1.resolve() == p2.resolve()
        except OSError:
            pass
    return p1 == p2


def normalize_path(file_path: str, resolve_symlinks: bool = True) -> str:
    """Returns normalized path."""
    path = pathlib.Path(file_path)
    if resolve_symlinks:
        path = path.resolve()
    return str(path)


def is_current_interpreter(executable: str) -> bool:
    """Returns true if the executable path is same as the current interpreter."""
    return is_same_path(executable, sys.executable)


def get_relative_path(file_path: str, workspace_root: str) -> str:
    """Returns the file path relative to the workspace root.

    Falls back to the original path if the workspace root is empty or
    the paths are on different drives (Windows).
    """
    if not workspace_root:
        return pathlib.Path(file_path).as_posix()
    try:
        return pathlib.Path(file_path).relative_to(workspace_root).as_posix()
    except ValueError:
        return pathlib.Path(file_path).as_posix()


def is_match(patterns: List[str], file_path: str, workspace_root: str = None) -> bool:
    """Returns true if the file matches one of the fnmatch patterns."""
    if not patterns:
        return False
    relative_path = (
        get_relative_path(file_path, workspace_root) if workspace_root else file_path
    )
    file_name = pathlib.Path(file_path).name
    return any(
        fnmatch.fnmatch(relative_path, pattern)
        or (not pattern.startswith("/") and fnmatch.fnmatch(file_name, pattern))
        for pattern in patterns
    )
