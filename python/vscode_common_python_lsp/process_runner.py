# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Runner to use when running under a different interpreter."""

from __future__ import annotations

import os
import sys
import traceback
from typing import Callable

from .context import substitute_attr


def update_sys_path(path_to_add: str, strategy: str) -> None:
    """Add given path to ``sys.path``.

    Parameters
    ----------
    path_to_add:
        The directory to add.
    strategy:
        ``"useBundled"`` inserts at position 0 (highest priority);
        any other value appends.
    """
    if path_to_add not in sys.path and os.path.isdir(path_to_add):
        if strategy == "useBundled":
            sys.path.insert(0, path_to_add)
        else:
            sys.path.append(path_to_add)


def run_message_loop(
    rpc,
    run_fn: Callable[..., object],
    result_cls: Callable[[str, str], object],
) -> None:
    """Process JSON-RPC messages in a loop until ``exit`` is received.

    Parameters
    ----------
    rpc:
        A ``JsonRpc`` instance connected to the parent process.
    run_fn:
        Callable with signature ``(module, argv, use_stdin, cwd, source=None)``
        that returns a result object with ``.stdout`` and ``.stderr`` attrs.
    result_cls:
        Callable ``(stdout, stderr) -> result`` used to wrap exceptions.
    """
    exit_now = False
    while not exit_now:
        msg = rpc.receive_data()

        method = msg["method"]
        if method == "exit":
            exit_now = True
            continue

        if method == "run":
            is_exception = False
            with substitute_attr(sys, "path", [""] + sys.path[:]):
                try:
                    result = run_fn(
                        module=msg["module"],
                        argv=msg["argv"],
                        use_stdin=msg["useStdin"],
                        cwd=msg["cwd"],
                        source=msg.get("source"),
                    )
                except Exception:
                    result = result_cls(
                        "", traceback.format_exc(chain=True)
                    )
                    is_exception = True

            response = {"id": msg["id"], "error": result.stderr}
            if is_exception:
                response["exception"] = is_exception
            elif result.stdout:
                response["result"] = result.stdout

            rpc.send_data(response)
