# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Test-only public LSP server; never invokes a formatter or linter."""

from __future__ import annotations

import json
import pathlib
import sys
from typing import Any

import lsprotocol.types as lsp

import vscode_common_python_lsp.server as server_module
from vscode_common_python_lsp.server import ToolServer, ToolServerConfig


def main() -> None:
    fixture_path = pathlib.Path(__file__).parent / "settings" / "producer.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    tool = ToolServer(
        ToolServerConfig(
            tool_module="settings-fixture",
            tool_display="Settings Fixture",
            default_settings=fixture["toolDefaults"],
        )
    )
    initialized_received = False

    @tool.server.feature(lsp.INITIALIZE)
    def initialize(params: lsp.InitializeParams) -> None:
        tool.apply_settings(params)
        tool.log_to_output("fixture initialize applied")

    @tool.server.feature(lsp.INITIALIZED)
    def initialized(_params: lsp.InitializedParams) -> None:
        nonlocal initialized_received
        initialized_received = True
        tool.log_to_output("fixture initialized")

    @tool.server.feature("test/settings")
    def inspect_settings(_params: Any) -> dict[str, Any]:
        return {
            "settings": tool.workspace_settings,
            "globalSettings": tool.global_settings,
            "initialized": initialized_received,
            "serverModule": server_module.__file__,
        }

    @tool.server.feature(lsp.SHUTDOWN)
    def shutdown(_params: Any) -> None:
        tool.handle_shutdown()
        print("fixture shutdown complete", file=sys.stderr, flush=True)

    @tool.server.feature(lsp.EXIT)
    def exit_server(_params: Any) -> None:
        tool.handle_exit()
        print("fixture exit complete", file=sys.stderr, flush=True)

    tool.server.start_io()


if __name__ == "__main__":
    main()
