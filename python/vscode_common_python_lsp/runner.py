# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tool execution runners for VS Code Python tool extensions."""

from __future__ import annotations

import contextlib
import io
import os
import runpy
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from .context import change_cwd, redirect_io, substitute_attr
from .paths import CWD_LOCK, is_same_path


@dataclass
class RunResult:
    """Object to hold result from running tool."""

    stdout: str
    stderr: str
    exit_code: int | str | None = None


class CustomIO(io.TextIOWrapper):
    """Custom stream object to replace stdio."""

    name = None

    def __init__(self, name, encoding="utf-8", newline=None):
        self._buffer = io.BytesIO()
        super().__init__(self._buffer, encoding=encoding, newline=newline)
        self.name = name

    def close(self):
        """Provide this close method which is used by some tools."""
        # This is intentionally empty.
        pass

    def get_value(self) -> str:
        """Returns value from the buffer as string."""
        self.seek(0)
        return self.read()


@contextlib.contextmanager
def _cwd_lock(cwd):
    """Acquire CWD_LOCK and optionally change directory."""
    with CWD_LOCK:
        if is_same_path(os.getcwd(), cwd):
            yield
        else:
            with change_cwd(cwd):
                yield


def run_module(
    module: str,
    argv: Sequence[str],
    use_stdin: bool,
    cwd: str,
    source: str | None = None,
) -> RunResult:
    """Runs a Python module via runpy (e.g. black, flake8).

    Captures stdout, stderr, and SystemExit exit codes.
    """
    with _cwd_lock(cwd):
        str_output = CustomIO("<stdout>", encoding="utf-8")
        str_error = CustomIO("<stderr>", encoding="utf-8")

        exit_code = None
        try:
            with substitute_attr(sys, "argv", list(argv)):
                with redirect_io("stdout", str_output):
                    with redirect_io("stderr", str_error):
                        if use_stdin:
                            str_input = CustomIO(
                                "<stdin>", encoding="utf-8", newline="\n"
                            )
                            with redirect_io("stdin", str_input):
                                if source is not None:
                                    str_input.write(source)
                                    str_input.seek(0)
                                runpy.run_module(module, run_name="__main__")
                        else:
                            runpy.run_module(module, run_name="__main__")
        except SystemExit as e:
            exit_code = e.code

        return RunResult(str_output.get_value(), str_error.get_value(), exit_code)


def run_path(
    argv: Sequence[str],
    use_stdin: bool,
    cwd: str,
    source: str | None = None,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> RunResult:
    """Runs tool as a subprocess via executable path."""
    if use_stdin:
        with subprocess.Popen(
            argv,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.PIPE,
            cwd=cwd,
            env=env,
        ) as process:
            try:
                stdout, stderr = process.communicate(input=source, timeout=timeout)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
            return RunResult(stdout, stderr, process.returncode)
    else:
        try:
            result = subprocess.run(
                argv,
                encoding="utf-8",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                cwd=cwd,
                env=env,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            return RunResult(e.stdout or "", e.stderr or "", None)
        return RunResult(result.stdout, result.stderr, result.returncode)


def run_api(
    callback: Callable[[Sequence[str], CustomIO, CustomIO, CustomIO | None], None],
    argv: Sequence[str],
    use_stdin: bool,
    cwd: str,
    source: str | None = None,
) -> RunResult:
    """Runs tool via API callback (importable tools).

    Captures stdout, stderr, and SystemExit exit codes.
    """
    with _cwd_lock(cwd):
        str_output = CustomIO("<stdout>", encoding="utf-8")
        str_error = CustomIO("<stderr>", encoding="utf-8")

        exit_code = None
        try:
            with substitute_attr(sys, "argv", list(argv)):
                with redirect_io("stdout", str_output):
                    with redirect_io("stderr", str_error):
                        if use_stdin:
                            str_input = CustomIO(
                                "<stdin>", encoding="utf-8", newline="\n"
                            )
                            with redirect_io("stdin", str_input):
                                if source is not None:
                                    str_input.write(source)
                                    str_input.seek(0)
                                callback(argv, str_output, str_error, str_input)
                        else:
                            callback(argv, str_output, str_error, None)
        except SystemExit as e:
            exit_code = e.code

        return RunResult(str_output.get_value(), str_error.get_value(), exit_code)
