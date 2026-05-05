# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.process_runner."""

import os
import sys
import unittest
from dataclasses import dataclass
from unittest.mock import MagicMock

from vscode_common_python_lsp.process_runner import (
    resolve_bundle_path,
    run_message_loop,
    update_environ_path,
    update_sys_path,
)


class TestUpdateSysPath(unittest.TestCase):
    """Tests for update_sys_path."""

    def test_use_bundled_inserts_at_front(self):
        original = sys.path[:]
        test_dir = os.path.dirname(__file__)
        # Remove if already present
        if test_dir in sys.path:
            sys.path.remove(test_dir)
        try:
            update_sys_path(test_dir, "useBundled")
            assert sys.path[0] == test_dir
        finally:
            sys.path[:] = original

    def test_other_strategy_appends(self):
        original = sys.path[:]
        test_dir = os.path.dirname(__file__)
        if test_dir in sys.path:
            sys.path.remove(test_dir)
        try:
            update_sys_path(test_dir, "fromEnvironment")
            assert sys.path[-1] == test_dir
        finally:
            sys.path[:] = original

    def test_skips_duplicate(self):
        original = sys.path[:]
        test_dir = os.path.dirname(__file__)
        # Ensure it's in sys.path
        if test_dir not in sys.path:
            sys.path.append(test_dir)
        count_before = sys.path.count(test_dir)
        try:
            update_sys_path(test_dir, "useBundled")
            assert sys.path.count(test_dir) == count_before
        finally:
            sys.path[:] = original

    def test_skips_nonexistent_dir(self):
        original = sys.path[:]
        fake_dir = "/nonexistent/dir/that/does/not/exist"
        try:
            update_sys_path(fake_dir, "useBundled")
            assert fake_dir not in sys.path
        finally:
            sys.path[:] = original


class TestUpdateEnvironPath(unittest.TestCase):
    """Tests for update_environ_path."""

    def test_adds_scripts_to_path(self):
        import sysconfig

        scripts = sysconfig.get_path("scripts")
        if not scripts:
            self.skipTest("sysconfig does not report scripts path")

        # Remove scripts from PATH if present
        original_env = os.environ.copy()
        path_var = "PATH" if "PATH" in os.environ else "Path"
        paths = os.environ.get(path_var, "").split(os.pathsep)
        paths = [p for p in paths if p != scripts]
        os.environ[path_var] = os.pathsep.join(paths)

        try:
            update_environ_path()
            new_paths = os.environ[path_var].split(os.pathsep)
            assert scripts in new_paths
            assert new_paths[0] == scripts
        finally:
            os.environ.clear()
            os.environ.update(original_env)

    def test_does_not_duplicate(self):
        import sysconfig

        scripts = sysconfig.get_path("scripts")
        if not scripts:
            self.skipTest("sysconfig does not report scripts path")

        original_env = os.environ.copy()
        path_var = "PATH" if "PATH" in os.environ else "Path"
        # Ensure scripts is already in PATH
        os.environ[path_var] = scripts + os.pathsep + os.environ.get(path_var, "")

        try:
            count_before = os.environ[path_var].split(os.pathsep).count(scripts)
            update_environ_path()
            count_after = os.environ[path_var].split(os.pathsep).count(scripts)
            assert count_after == count_before
        finally:
            os.environ.clear()
            os.environ.update(original_env)


@dataclass
class _MockResult:
    """Minimal result object for testing."""

    stdout: str
    stderr: str


class TestRunMessageLoop(unittest.TestCase):
    """Tests for run_message_loop."""

    def _make_rpc(self, messages):
        """Create a mock RPC that yields messages in order."""
        rpc = MagicMock()
        rpc.receive_data = MagicMock(side_effect=messages)
        return rpc

    def test_exit_message_stops_loop(self):
        rpc = self._make_rpc([{"method": "exit"}])
        run_message_loop(rpc, MagicMock(), _MockResult)
        rpc.receive_data.assert_called_once()

    def test_run_message_calls_run_fn(self):
        run_fn = MagicMock(return_value=_MockResult("output", ""))
        messages = [
            {
                "id": "1",
                "method": "run",
                "module": "black",
                "argv": ["--check", "."],
                "useStdin": False,
                "cwd": "/tmp",
                "source": "code",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        run_fn.assert_called_once_with(
            module="black",
            argv=["--check", "."],
            use_stdin=False,
            cwd="/tmp",
            source="code",
        )

    def test_run_sends_response_with_result(self):
        run_fn = MagicMock(return_value=_MockResult("formatted code", ""))
        messages = [
            {
                "id": "1",
                "method": "run",
                "module": "black",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        sent = rpc.send_data.call_args[0][0]
        assert sent["id"] == "1"
        assert sent["result"] == "formatted code"
        assert sent["error"] == ""
        assert "exception" not in sent

    def test_run_sends_error_response(self):
        run_fn = MagicMock(return_value=_MockResult("", "some error"))
        messages = [
            {
                "id": "2",
                "method": "run",
                "module": "flake8",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        sent = rpc.send_data.call_args[0][0]
        assert sent["id"] == "2"
        assert sent["error"] == "some error"

    def test_run_handles_exception(self):
        run_fn = MagicMock(side_effect=RuntimeError("boom"))
        messages = [
            {
                "id": "3",
                "method": "run",
                "module": "pylint",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        sent = rpc.send_data.call_args[0][0]
        assert sent["id"] == "3"
        assert sent["exception"] is True
        # Traceback includes non-deterministic file paths and line numbers
        assert "boom" in sent["error"]

    def test_source_defaults_to_none(self):
        """When message has no 'source' key, run_fn gets source=None."""
        run_fn = MagicMock(return_value=_MockResult("", ""))
        messages = [
            {
                "id": "4",
                "method": "run",
                "module": "isort",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        call_kwargs = run_fn.call_args[1]
        assert call_kwargs["source"] is None

    def test_preserves_sys_path(self):
        """sys.path is restored after each run."""
        original_path = sys.path[:]
        run_fn = MagicMock(return_value=_MockResult("", ""))
        messages = [
            {
                "id": "5",
                "method": "run",
                "module": "test",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        assert sys.path == original_path

    def test_empty_stdout_includes_result_key(self):
        """When stdout is empty string, result key should still be present."""
        run_fn = MagicMock(return_value=_MockResult("", ""))
        messages = [
            {
                "id": "6",
                "method": "run",
                "module": "black",
                "argv": [],
                "useStdin": False,
                "cwd": "/tmp",
            },
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, run_fn, _MockResult)

        sent = rpc.send_data.call_args[0][0]
        assert "result" in sent
        assert sent["result"] == ""

    def test_unknown_method_sends_error_response(self):
        """Unknown RPC methods should send an error response, not hang."""
        messages = [
            {"id": "7", "method": "unknown_method"},
            {"method": "exit"},
        ]
        rpc = self._make_rpc(messages)

        run_message_loop(rpc, MagicMock(), _MockResult)

        sent = rpc.send_data.call_args[0][0]
        assert sent["id"] == "7"
        assert "Unknown method: unknown_method" in sent["error"]


class TestBootstrapSysPath(unittest.TestCase):
    """Tests for resolve_bundle_path (and its alias bootstrap_sys_path)."""

    def test_adds_tool_and_libs_dirs(self):
        """resolve_bundle_path adds both tool/ and libs/ to sys.path."""
        import tempfile

        original = sys.path[:]
        with tempfile.TemporaryDirectory() as tmp:
            # Create the expected directory layout:
            # <tmp>/tool/lsp_server.py
            # <tmp>/libs/
            tool_dir = os.path.join(tmp, "tool")
            libs_dir = os.path.join(tmp, "libs")
            os.makedirs(tool_dir)
            os.makedirs(libs_dir)
            script = os.path.join(tool_dir, "lsp_server.py")
            open(script, "w").close()

            try:
                result = resolve_bundle_path(script)
                assert result == tmp
                assert tool_dir in sys.path
                assert libs_dir in sys.path
                # Both should be at the front of sys.path (before original entries)
                assert sys.path.index(tool_dir) < len(original)
                assert sys.path.index(libs_dir) < len(original)
            finally:
                sys.path[:] = original

    def test_returns_bundle_dir_path(self):
        """resolve_bundle_path returns the bundle directory."""
        import tempfile

        original = sys.path[:]
        with tempfile.TemporaryDirectory() as tmp:
            tool_dir = os.path.join(tmp, "tool")
            libs_dir = os.path.join(tmp, "libs")
            os.makedirs(tool_dir)
            os.makedirs(libs_dir)
            script = os.path.join(tool_dir, "lsp_server.py")
            open(script, "w").close()

            try:
                result = resolve_bundle_path(script)
                assert result == tmp
            finally:
                sys.path[:] = original

    def test_respects_ls_import_strategy_env(self):
        """When LS_IMPORT_STRATEGY=fromEnvironment, libs are appended."""
        import tempfile

        original = sys.path[:]
        original_env = os.environ.copy()
        with tempfile.TemporaryDirectory() as tmp:
            tool_dir = os.path.join(tmp, "tool")
            libs_dir = os.path.join(tmp, "libs")
            os.makedirs(tool_dir)
            os.makedirs(libs_dir)
            script = os.path.join(tool_dir, "lsp_server.py")
            open(script, "w").close()

            os.environ["LS_IMPORT_STRATEGY"] = "fromEnvironment"
            try:
                len_before = len(sys.path)
                resolve_bundle_path(script)
                assert libs_dir in sys.path
                # libs should be appended after existing entries
                assert sys.path.index(libs_dir) >= len_before
            finally:
                sys.path[:] = original
                os.environ.clear()
                os.environ.update(original_env)


if __name__ == "__main__":
    unittest.main()
