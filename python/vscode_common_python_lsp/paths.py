# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Path utilities for VS Code Python tool extensions."""

from __future__ import annotations

import fnmatch
import os
import os.path
import pathlib
import sys
import sysconfig
import threading
from typing import Any, List, Tuple, Union

# Save the working directory used when loading this module
SERVER_CWD = os.getcwd()
CWD_LOCK = threading.Lock()


def as_list(content: Union[Any, List[Any], Tuple[Any]]) -> List[Any]:
    """Ensures we always get a list."""
    if isinstance(content, (list, tuple)):
        return list(content)
    return [content]


def get_sys_config_paths() -> List[str]:
    """Returns actual Python standard library paths from sysconfig.get_paths()."""
    return [
        path
        for group, path in sysconfig.get_paths().items()
        if group in ["stdlib", "platstdlib"]
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


_stdlib_paths = set(
    str(pathlib.Path(p).resolve())
    for p in (get_sys_config_paths() + get_extensions_dir())
)


def is_same_path(file_path1: str, file_path2: str) -> bool:
    """Returns true if two paths are the same."""
    return pathlib.Path(file_path1) == pathlib.Path(file_path2)


def normalize_path(file_path: str, resolve_symlinks: bool = True) -> str:
    """Returns normalized path."""
    path = pathlib.Path(file_path)
    if resolve_symlinks:
        path = path.resolve()
    return str(path)


def is_current_interpreter(executable: str) -> bool:
    """Returns true if the executable path is same as the current interpreter."""
    return is_same_path(executable, sys.executable)


def is_stdlib_file(file_path: str) -> bool:
    """Return True if the file belongs to the standard library.

    Excludes third-party packages in site-packages/dist-packages by checking
    path components, and compares against known stdlib + extensions paths.
    """
    normalized_path = normalize_path(file_path, resolve_symlinks=True)

    # Exclude site-packages and dist-packages directories which contain third-party packages
    # Use pathlib.PurePath.parts for cross-platform compatibility (handles forward/backward slashes)
    path_parts = pathlib.PurePath(normalized_path).parts
    if "site-packages" in path_parts or "dist-packages" in path_parts:
        return False

    return any(normalized_path.startswith(path) for path in _stdlib_paths)


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
