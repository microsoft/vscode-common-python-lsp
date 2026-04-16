# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.jsonrpc."""

import io
import threading
import unittest
from unittest.mock import MagicMock, patch

from vscode_common_python_lsp.jsonrpc import (
    CONTENT_LENGTH,
    JsonReader,
    JsonRpc,
    JsonWriter,
    ProcessManager,
    RpcRunResult,
    StreamClosedException,
    create_json_rpc,
    to_str,
)


class TestToStr(unittest.TestCase):
    """Tests for to_str helper."""

    def test_bytes_to_str(self):
        assert to_str(b"hello") == "hello"

    def test_str_passthrough(self):
        assert to_str("hello") == "hello"

    def test_utf8_bytes(self):
        assert to_str("café".encode("utf-8")) == "café"


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


if __name__ == "__main__":
    unittest.main()
