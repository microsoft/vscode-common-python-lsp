# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for runner module."""

import sys

from vscode_common_python_lsp.runner import (
    CustomIO,
    RunResult,
    run_api,
    run_module,
    run_path,
)


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


class TestRunModule:
    def test_basic_execution(self, tmp_path):
        """run_module can execute a stdlib module like json.tool."""
        result = run_module(
            "json.tool",
            ["json.tool"],
            use_stdin=True,
            cwd=str(tmp_path),
            source='{"key": "value"}',
        )
        assert '"key"' in result.stdout
        assert '"value"' in result.stdout

    def test_captures_exit_code(self, tmp_path):
        """SystemExit exit codes are captured."""

        def _callback(argv, stdout, stderr, stdin=None):
            raise SystemExit(42)

        result = run_api(
            _callback,
            ["test"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.exit_code == 42

    def test_captures_stderr(self, tmp_path):
        """Stderr output is captured separately."""

        def _callback(argv, stdout, stderr, stdin=None):
            stderr.write("error message")

        result = run_api(
            _callback,
            ["test"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.stderr == "error message"


class TestRunApi:
    def test_basic_callback(self, tmp_path):
        """run_api executes a callback and captures output."""

        def _callback(argv, stdout, stderr, stdin=None):
            stdout.write("api output")

        result = run_api(
            _callback,
            ["tool", "--arg"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.stdout == "api output"
        assert result.stderr == ""

    def test_callback_with_stdin(self, tmp_path):
        """run_api passes stdin to callback when use_stdin=True."""

        def _callback(argv, stdout, stderr, stdin):
            data = stdin.read()
            stdout.write(f"got: {data}")

        result = run_api(
            _callback,
            ["tool"],
            use_stdin=True,
            cwd=str(tmp_path),
            source="input data",
        )
        assert result.stdout == "got: input data"

    def test_callback_receives_argv(self, tmp_path):
        """run_api passes argv to the callback."""

        def _callback(argv, stdout, stderr, stdin=None):
            stdout.write(",".join(argv))

        result = run_api(
            _callback,
            ["tool", "--flag", "value"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.stdout == "tool,--flag,value"

    def test_system_exit_captured(self, tmp_path):
        """SystemExit is caught and exit code stored."""

        def _callback(argv, stdout, stderr, stdin=None):
            stdout.write("before exit")
            raise SystemExit(1)

        result = run_api(
            _callback,
            ["tool"],
            use_stdin=False,
            cwd=str(tmp_path),
        )
        assert result.exit_code == 1
        assert "before exit" in result.stdout
