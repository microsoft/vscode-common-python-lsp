# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Runner to use when running under a different interpreter."""

from __future__ import annotations

import os
import sys
import sysconfig
import traceback
from collections.abc import Callable
from typing import TYPE_CHECKING

from .context import substitute_attr

if TYPE_CHECKING:
    from .jsonrpc import JsonRpc


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


def resolve_bundle_path(script_file: str) -> str:
    """Resolve the bundle directory and configure ``sys.path`` for a bundled LSP server.

    Call this at the top of your ``lsp_server.py`` (before importing
    any bundled libraries) to replace the standard 7-line boilerplate::

        # Instead of:
        BUNDLE_DIR = pathlib.Path(__file__).parent.parent
        update_sys_path(os.fspath(BUNDLE_DIR / "tool"), "useBundled")
        update_sys_path(
            os.fspath(BUNDLE_DIR / "libs"),
            os.getenv("LS_IMPORT_STRATEGY", "useBundled"),
        )

        # Use:
        from vscode_common_python_lsp import resolve_bundle_path
        BUNDLE_DIR = resolve_bundle_path(__file__)

    Parameters
    ----------
    script_file:
        The ``__file__`` of the calling script (expected to be at
        ``<bundle>/tool/lsp_server.py``).

    Returns
    -------
    str
        The resolved bundle directory path (``<extension>/bundled/``),
        for any further use by the caller.
    """
    import pathlib

    bundle_dir = pathlib.Path(script_file).parent.parent
    bundle_str = os.fspath(bundle_dir)

    # Always put the tool directory first (bundled server modules)
    update_sys_path(os.fspath(bundle_dir / "tool"), "useBundled")

    # Libs follow the LS_IMPORT_STRATEGY env var
    update_sys_path(
        os.fspath(bundle_dir / "libs"),
        os.getenv("LS_IMPORT_STRATEGY", "useBundled"),
    )

    return bundle_str


def update_environ_path() -> None:
    """Update PATH environment variable with the ``scripts`` directory.

    Ensures tool executables installed in the virtual environment's scripts
    directory (``Scripts`` on Windows, ``bin`` on Unix) are discoverable.
    """
    scripts = sysconfig.get_path("scripts")
    if not scripts:
        return
    for var_name in ("Path", "PATH"):
        if var_name in os.environ:
            paths = os.environ[var_name].split(os.pathsep)
            if scripts not in paths:
                paths.insert(0, scripts)
                os.environ[var_name] = os.pathsep.join(paths)
            break


def run_message_loop(
    rpc: JsonRpc,
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
                    result = result_cls("", traceback.format_exc(chain=True))
                    is_exception = True

            response: dict[str, object] = {
                "id": msg["id"],
                "error": result.stderr,
            }
            if is_exception:
                response["exception"] = is_exception
            elif result.stdout is not None:
                response["result"] = result.stdout

            rpc.send_data(response)
        else:
            rpc.send_data(
                {
                    "id": msg.get("id", ""),
                    "error": f"Unknown method: {method}",
                }
            )
