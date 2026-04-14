# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for runner module."""

import sys

import pytest

from vscode_common_python_lsp.runner import CustomIO, RunResult, run_path


class TestRunResult:
    def test_basic(self):
        r = RunResult("out", "err")
        assert r.stdout == "out"
        assert r.stderr == "err"
        assert r.exit_code is None

    def test_with_exit_code(self):
        r = RunResult("out", "err", 1)
        assert r.exit_code == 1


class TestCustomIO:
    def test_write_and_read(self):
        c = CustomIO("<test>")
        c.write("hello")
        assert c.get_value() == "hello"

    def test_close_is_noop(self):
        c = CustomIO("<test>")
        c.close()  # should not raise
        c.write("still works")
        assert c.get_value() == "still works"


class TestRunPath:
    def test_simple_command(self, tmp_path):
        result = run_path(
            [sys.executable, "-c", "print('hello')"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert "hello" in result.stdout
        assert result.exit_code == 0

    def test_with_stdin(self, tmp_path):
        result = run_path(
            [sys.executable, "-c", "import sys; print(sys.stdin.read())"],
            use_stdin=True,
            cwd=str(tmp_path),
            source="test input",
        )
        assert "test input" in result.stdout

    def test_exit_code_captured(self, tmp_path):
        result = run_path(
            [sys.executable, "-c", "import sys; sys.exit(42)"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.exit_code == 42

    def test_with_env(self, tmp_path):
        import os

        env = {**os.environ, "TEST_VAR": "hello_from_env"}
        result = run_path(
            [sys.executable, "-c", "import os; print(os.environ['TEST_VAR'])"],
            use_stdin=False,
            cwd=str(tmp_path),
            env=env,
        )
        assert "hello_from_env" in result.stdout
