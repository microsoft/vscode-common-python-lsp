# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Shared Python utilities for VS Code Python tool extensions."""

from .code_actions import (
    QuickFixRegistrationError,
    QuickFixRegistry,
    command_quick_fix,
    create_workspace_edit,
)
from .context import change_cwd, redirect_io, substitute_attr
from .debug import setup_debugpy
from .diagnostics import (
    ParsedRecord,
    get_severity,
    make_diagnostic,
    parse_diagnostics_regex,
)
from .formatting import is_notebook_cell, match_line_endings, strip_trailing_newline
from .jsonrpc import (
    JsonRpc,
    ProcessManager,
    RpcRunResult,
    StreamClosedException,
    get_or_start_json_rpc,
    run_over_json_rpc,
    shutdown_json_rpc,
)
from .linting import LintRequestTracker
from .notebook import (
    MAGIC_LINE_RE,
    NOTEBOOK_SYNC_OPTIONS,
    CellMap,
    CellOffset,
    SyntheticDocument,
    build_notebook_source,
    get_cell_for_line,
    remap_diagnostics_to_cells,
)
from .paths import (
    CWD_LOCK,
    SERVER_CWD,
    PythonFileKind,
    as_list,
    classify_python_file,
    get_extensions_dir,
    get_relative_path,
    get_sys_config_paths,
    is_current_interpreter,
    is_match,
    is_same_path,
    normalize_path,
)
from .process_runner import run_message_loop, update_sys_path
from .runner import CustomIO, RunResult, run_api, run_module, run_path
from .server import ToolServer, ToolServerConfig
from .version import (
    VersionInfo,
    check_min_version,
    extract_version,
    parse_version,
    version_to_tuple,
)

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
    "classify_python_file",
    "PythonFileKind",
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
    # jsonrpc
    "StreamClosedException",
    "JsonRpc",
    "ProcessManager",
    "RpcRunResult",
    "get_or_start_json_rpc",
    "run_over_json_rpc",
    "shutdown_json_rpc",
    # process_runner
    "update_sys_path",
    "run_message_loop",
    # debug
    "setup_debugpy",
    # server
    "ToolServerConfig",
    "ToolServer",
    # code_actions
    "QuickFixRegistrationError",
    "QuickFixRegistry",
    "command_quick_fix",
    "create_workspace_edit",
    # diagnostics
    "ParsedRecord",
    "get_severity",
    "make_diagnostic",
    "parse_diagnostics_regex",
    # formatting
    "match_line_endings",
    "is_notebook_cell",
    "strip_trailing_newline",
    # linting
    "LintRequestTracker",
    # notebook
    "SyntheticDocument",
    "CellOffset",
    "CellMap",
    "MAGIC_LINE_RE",
    "NOTEBOOK_SYNC_OPTIONS",
    "build_notebook_source",
    "get_cell_for_line",
    "remap_diagnostics_to_cells",
    # version
    "VersionInfo",
    "extract_version",
    "check_min_version",
    "parse_version",
    "version_to_tuple",
]
