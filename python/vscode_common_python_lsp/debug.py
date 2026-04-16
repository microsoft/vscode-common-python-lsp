# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Debugging support for LSP."""

from __future__ import annotations

import os
import pathlib
import sys


def _update_sys_path(path_to_add: str) -> None:
    """Add given path to ``sys.path`` if it exists."""
    if path_to_add not in sys.path and os.path.isdir(path_to_add):
        sys.path.append(path_to_add)


def setup_debugpy(port: int = 5678) -> None:
    """Conditionally attach debugpy if ``USE_DEBUGPY`` is set.

    Checks the ``USE_DEBUGPY`` environment variable and, when enabled,
    loads debugpy from ``DEBUGPY_PATH`` and connects to the given *port*.

    This uses the secure opt-in pattern from black/isort/pylint where
    both ``USE_DEBUGPY`` **and** ``DEBUGPY_PATH`` must be set.
    """
    if os.getenv("USE_DEBUGPY", None) not in ("True", "TRUE", "1", "T"):
        return

    debugger_path = os.getenv("DEBUGPY_PATH", None)
    if not debugger_path:
        return

    if debugger_path.endswith("debugpy"):
        debugger_path = os.fspath(pathlib.Path(debugger_path).parent)

    _update_sys_path(debugger_path)

    import debugpy  # noqa: E402

    debugpy.connect(port)
    debugpy.breakpoint()
