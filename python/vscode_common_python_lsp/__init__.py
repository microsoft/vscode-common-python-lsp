# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Shared Python utilities for VS Code Python tool extensions."""

__version__ = "0.1.0"

from .context import change_cwd, redirect_io, substitute_attr
from .paths import (
    CWD_LOCK,
    SERVER_CWD,
    as_list,
    get_extensions_dir,
    get_relative_path,
    get_sys_config_paths,
    is_current_interpreter,
    is_match,
    is_same_path,
    is_stdlib_file,
    normalize_path,
)
from .runner import CustomIO, RunResult, run_api, run_module, run_path

__all__ = [
    # paths
    "SERVER_CWD",
    "CWD_LOCK",
    "as_list",
    "get_sys_config_paths",
    "get_extensions_dir",
    "get_relative_path",
    "normalize_path",
    "is_same_path",
    "is_current_interpreter",
    "is_stdlib_file",
    "is_match",
    # context
    "substitute_attr",
    "redirect_io",
    "change_cwd",
    # runner
    "RunResult",
    "CustomIO",
    "run_module",
    "run_path",
    "run_api",
]
