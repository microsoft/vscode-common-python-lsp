# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.jsonrpc."""

import io
import threading
import unittest
from unittest.mock import MagicMock, patch

import pytest

from vscode_common_python_lsp.jsonrpc import (
    CONTENT_LENGTH,
    JsonReader,
    JsonRpc,
    JsonWriter,
    ProcessManager,
    RpcRunResult,
    StreamClosedException,
    create_json_rpc,
    run_over_json_rpc,
)


class TestJsonWriterReader(unittest.TestCase):
    """Tests for JsonWriter / JsonReader round-trip."""

    def _make_streams(self):
        """Create a pipe-like pair of binary streams."""
        buf = io.BytesIO()
        return buf, buf

    def test_write_read_roundtrip(self):
        buf = io.BytesIO()
        writer = JsonWriter(buf)
        data = {"id": "1", "method": "test", "params": [1, 2, 3]}
        writer.write(data)

        buf.seek(0)
        reader = JsonReader(buf)
        result = reader.read()
        assert result == data

    def test_multiple_messages(self):
        buf = io.BytesIO()
        writer = JsonWriter(buf)
        msgs = [
            {"id": "1", "method": "run"},
            {"id": "2", "method": "exit"},
        ]
        for m in msgs:
            writer.write(m)

        buf.seek(0)
        reader = JsonReader(buf)
        for expected in msgs:
            assert reader.read() == expected

    def test_write_to_closed_stream_raises(self):
        buf = io.BytesIO()
        writer = JsonWriter(buf)
        buf.close()
        with self.assertRaises(StreamClosedException):
            writer.write({"id": "1"})

    def test_read_from_closed_stream_raises(self):
        buf = io.BytesIO()
        reader = JsonReader(buf)
        buf.close()
        with self.assertRaises(StreamClosedException):
            reader.read()

    def test_read_from_empty_stream_raises_eof(self):
        buf = io.BytesIO(b"")
        reader = JsonReader(buf)
        with self.assertRaises(EOFError):
            reader.read()

    def test_unicode_content(self):
        buf = io.BytesIO()
        writer = JsonWriter(buf)
        data = {"message": "héllo wörld 日本語"}
        writer.write(data)

        buf.seek(0)
        reader = JsonReader(buf)
        assert reader.read() == data

    def test_content_length_header_format(self):
        buf = io.BytesIO()
        writer = JsonWriter(buf)
        data = {"id": "1"}
        writer.write(data)

        raw = buf.getvalue().decode("utf-8")
        assert raw.startswith(CONTENT_LENGTH)
        assert "\r\n\r\n" in raw


class TestJsonRpc(unittest.TestCase):
    """Tests for JsonRpc wrapper."""

    def test_send_receive(self):
        buf = io.BytesIO()
        rpc = JsonRpc(buf, buf)
        data = {"id": "42", "method": "run"}
        rpc.send_data(data)

        buf.seek(0)
        rpc2 = JsonRpc(buf, io.BytesIO())
        assert rpc2.receive_data() == data

    def test_close_suppresses_errors(self):
        reader = io.BytesIO()
        writer = io.BytesIO()
        rpc = JsonRpc(reader, writer)
        reader.close()
        writer.close()
        # Should not raise
        rpc.close()


class TestCreateJsonRpc(unittest.TestCase):
    def test_returns_json_rpc_instance(self):
        r = io.BytesIO()
        w = io.BytesIO()
        rpc = create_json_rpc(r, w)
        assert isinstance(rpc, JsonRpc)


class TestRpcRunResult(unittest.TestCase):
    """Tests for RpcRunResult."""

    def test_basic_result(self):
        r = RpcRunResult("out", "err")
        assert r.stdout == "out"
        assert r.stderr == "err"
        assert r.exception is None

    def test_with_exception(self):
        r = RpcRunResult("out", "", "traceback")
        assert r.exception == "traceback"


class TestProcessManager(unittest.TestCase):
    """Tests for ProcessManager."""

    def test_get_json_rpc_raises_when_not_started(self):
        pm = ProcessManager()
        with self.assertRaises(StreamClosedException):
            pm.get_json_rpc("nonexistent")

    @patch("vscode_common_python_lsp.jsonrpc.subprocess.Popen")
    def test_start_process_registers_rpc(self, mock_popen):
        pm = ProcessManager()
        mock_proc = MagicMock()
        mock_proc.stdout = io.BytesIO()
        mock_proc.stdin = io.BytesIO()
        # Block the monitor thread so it doesn't clean up before we check
        wait_event = threading.Event()
        mock_proc.wait = MagicMock(side_effect=lambda: wait_event.wait())
        mock_popen.return_value = mock_proc

        pm.start_process("ws1", ["python", "runner.py"], "/tmp")
        rpc = pm.get_json_rpc("ws1")
        assert isinstance(rpc, JsonRpc)
        wait_event.set()

    @patch("vscode_common_python_lsp.jsonrpc.subprocess.Popen")
    def test_start_process_with_env(self, mock_popen):
        pm = ProcessManager()
        mock_proc = MagicMock()
        mock_proc.stdout = io.BytesIO()
        mock_proc.stdin = io.BytesIO()
        wait_event = threading.Event()
        mock_proc.wait = MagicMock(side_effect=lambda: wait_event.wait())
        mock_popen.return_value = mock_proc

        pm.start_process("ws1", ["python"], "/tmp", env={"FOO": "bar"})
        call_kwargs = mock_popen.call_args[1]
        assert call_kwargs["env"]["FOO"] == "bar"
        wait_event.set()

    @patch("vscode_common_python_lsp.jsonrpc.subprocess.Popen")
    def test_stop_process(self, mock_popen):
        pm = ProcessManager()
        mock_proc = MagicMock()
        mock_proc.stdout = io.BytesIO()
        mock_proc.stdin = io.BytesIO()
        wait_event = threading.Event()
        mock_proc.wait = MagicMock(side_effect=lambda: wait_event.wait())
        mock_popen.return_value = mock_proc

        pm.start_process("ws1", ["python"], "/tmp")
        # Release the monitor thread before stopping
        wait_event.set()
        pm.stop_process("ws1")

        mock_proc.kill.assert_called()
        with self.assertRaises(StreamClosedException):
            pm.get_json_rpc("ws1")

    def test_stop_process_nonexistent_is_noop(self):
        pm = ProcessManager()
        # Should not raise
        pm.stop_process("nonexistent")

    def test_stop_all_processes_empty(self):
        pm = ProcessManager()
        # Should not raise
        pm.stop_all_processes()


# ---------------------------------------------------------------------------
# run_over_json_rpc tests
# ---------------------------------------------------------------------------

FIXED_UUID = "test-uuid-1234"
MODULE = "jsonrpc"
PATCH_PREFIX = "vscode_common_python_lsp.jsonrpc"


class TestRunOverJsonRpc(unittest.TestCase):
    """Tests for run_over_json_rpc."""

    def _patch_rpc(self, receive_return):
        """Set up mocks: get_or_start_json_rpc returns a fake RPC, uuid4 is fixed."""
        mock_rpc = MagicMock()
        mock_rpc.receive_data.return_value = receive_return
        return mock_rpc

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_success_with_error_key(self, mock_get_rpc, _mock_uuid):
        """Normal success: runner sends error="" and result=stdout."""
        response = {
            "id": FIXED_UUID,
            "error": "",
            "result": "formatted output",
        }
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws", ["python"], "black", ["--check"], True, "/tmp", "runner.py"
        )

        assert result.stdout == "formatted output"
        assert result.stderr == ""
        assert result.exception is None
        mock_rpc.send_data.assert_called_once()

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_success_without_error_key(self, mock_get_rpc, _mock_uuid):
        """Response without error key (e.g. non-standard runner)."""
        response = {"id": FIXED_UUID, "result": "output"}
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws", ["python"], "mod", [], True, "/tmp", "runner.py"
        )

        assert result.stdout == "output"
        assert result.stderr == ""
        assert result.exception is None

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_error_with_stderr(self, mock_get_rpc, _mock_uuid):
        """Error response: runner sends non-empty error."""
        response = {
            "id": FIXED_UUID,
            "error": "some warning\n",
            "result": "partial output",
        }
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws", ["python"], "mod", [], True, "/tmp", "runner.py"
        )

        assert result.stdout == "partial output"
        assert result.stderr == "some warning\n"
        assert result.exception is None

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_exception_response(self, mock_get_rpc, _mock_uuid):
        """Exception response: runner sends exception=True with traceback."""
        response = {
            "id": FIXED_UUID,
            "error": "Traceback (most recent call last):\n  ...",
            "exception": True,
        }
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws", ["python"], "mod", [], True, "/tmp", "runner.py"
        )

        assert result.stdout == ""
        assert result.stderr == ""
        assert result.exception == "Traceback (most recent call last):\n  ..."

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_mismatched_id(self, mock_get_rpc, _mock_uuid):
        """Response with wrong id returns error message."""
        response = {"id": "wrong-id", "error": "", "result": "output"}
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws", ["python"], "mod", [], True, "/tmp", "runner.py"
        )

        assert result.stdout == ""
        assert "Invalid result for request" in result.stderr
        assert result.exception is None

    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc", return_value=None)
    def test_connection_failure_raises(self, _mock_get_rpc):
        """Raises ConnectionError when RPC cannot be established."""
        with pytest.raises(ConnectionError, match="Failed to run over JSON-RPC"):
            run_over_json_rpc("ws", ["python"], "mod", [], True, "/tmp", "runner.py")

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_source_included_in_message(self, mock_get_rpc, _mock_uuid):
        """When source is provided, it's included in the RPC message."""
        response = {"id": FIXED_UUID, "error": "", "result": ""}
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        run_over_json_rpc(
            "ws",
            ["python"],
            "mod",
            [],
            True,
            "/tmp",
            "runner.py",
            source="x = 1\n",
        )

        sent_msg = mock_rpc.send_data.call_args[0][0]
        assert sent_msg["source"] == "x = 1\n"

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_source_omitted_when_none(self, mock_get_rpc, _mock_uuid):
        """When source is None, the message omits the source key."""
        response = {"id": FIXED_UUID, "error": "", "result": ""}
        mock_rpc = self._patch_rpc(response)
        mock_get_rpc.return_value = mock_rpc

        run_over_json_rpc("ws", ["python"], "mod", [], True, "/tmp", "runner.py")

        sent_msg = mock_rpc.send_data.call_args[0][0]
        assert "source" not in sent_msg


class TestRunOverJsonRpcTimeout(unittest.TestCase):
    """Tests for run_over_json_rpc timeout behavior."""

    @patch(f"{PATCH_PREFIX}._process_manager")
    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_timeout_calls_stop_process(self, mock_get_rpc, _mock_uuid, mock_pm):
        """Timeout triggers stop_process and raises TimeoutError."""
        block = threading.Event()
        mock_rpc = MagicMock()
        mock_rpc.receive_data.side_effect = lambda: block.wait()
        mock_get_rpc.return_value = mock_rpc

        with pytest.raises(TimeoutError, match="timed out after 0.05s"):
            run_over_json_rpc(
                "ws",
                ["python"],
                "mod",
                [],
                True,
                "/tmp",
                "runner.py",
                timeout=0.05,
            )

        mock_pm.stop_process.assert_called_once_with("ws")
        block.set()  # Release daemon thread

    @patch(f"{PATCH_PREFIX}.uuid.uuid4", return_value=FIXED_UUID)
    @patch(f"{PATCH_PREFIX}.get_or_start_json_rpc")
    def test_timeout_returns_normally_when_fast(self, mock_get_rpc, _mock_uuid):
        """When response arrives before timeout, returns normally."""
        response = {"id": FIXED_UUID, "error": "", "result": "fast"}
        mock_rpc = MagicMock()
        mock_rpc.receive_data.return_value = response
        mock_get_rpc.return_value = mock_rpc

        result = run_over_json_rpc(
            "ws",
            ["python"],
            "mod",
            [],
            True,
            "/tmp",
            "runner.py",
            timeout=5.0,
        )

        assert result.stdout == "fast"
        assert result.stderr == ""


if __name__ == "__main__":
    unittest.main()
