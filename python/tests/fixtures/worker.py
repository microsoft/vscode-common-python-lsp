# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Test-only worker using the same shared runner primitives as consumers."""

import sys

from vscode_common_python_lsp.jsonrpc import JsonRpc
from vscode_common_python_lsp.process_runner import run_message_loop
from vscode_common_python_lsp.runner import RunResult, run_module

if __name__ == "__main__":
    run_message_loop(
        JsonRpc(sys.stdin.buffer, sys.stdout.buffer), run_module, RunResult
    )
