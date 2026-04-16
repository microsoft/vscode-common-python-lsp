# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Debugging support for LSP."""

from __future__ import annotations

import os
import pathlib

from .process_runner import update_sys_path


def setup_debugpy(port: int = 5678, *, require_opt_in: bool = True) -> None:
    """Conditionally attach debugpy if the environment is configured.

    Checks the ``DEBUGPY_PATH`` environment variable and, when present,
    loads debugpy from that path and connects to the given *port*.

    Parameters
    ----------
    port:
        The port to connect to for debugging.
    require_opt_in:
        When ``True`` (default), the ``USE_DEBUGPY`` environment variable
        must also be set to a truthy value (``True``, ``TRUE``, ``1``, or
        ``T``).  Set to ``False`` to skip this check — useful for
        extensions that don't gate on ``USE_DEBUGPY`` (e.g. flake8, mypy).
    """
    if require_opt_in and os.getenv("USE_DEBUGPY", None) not in (
        "True",
        "TRUE",
        "1",
        "T",
    ):
        return

    debugger_path = os.getenv("DEBUGPY_PATH", None)
    if not debugger_path:
        return

    if pathlib.Path(debugger_path).name == "debugpy":
        debugger_path = os.fspath(pathlib.Path(debugger_path).parent)

    update_sys_path(debugger_path, "fromEnvironment")

    import debugpy  # noqa: E402

    debugpy.connect(port)
    debugpy.breakpoint()
