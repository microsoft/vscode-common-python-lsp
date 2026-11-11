# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Exercise the real ToolServer/pygls lifecycle over public LSP stdio."""

from __future__ import annotations

import contextlib
import json
import os
import pathlib
import queue
import subprocess
import sys
import threading
import time
from typing import Any

from pygls import uris

import vscode_common_python_lsp.server as server_module

from .settings_fixtures import load_settings_fixture

PYTHON_ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVER_FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "settings_server.py"
TIMEOUT = 20


class _LspProcess:
    def __init__(self, cwd: pathlib.Path):
        assert pathlib.Path(server_module.__file__).resolve() == (
            PYTHON_ROOT / "vscode_common_python_lsp" / "server.py"
        ), "Bind PYTHONPATH to this checkout before running the tests"
        env = {
            **os.environ,
            "PYTHONPATH": str(PYTHON_ROOT),
            "PYTHONIOENCODING": "utf-8",
        }
        self.process = subprocess.Popen(
            [sys.executable, "-u", str(SERVER_FIXTURE)],
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.messages: queue.Queue[dict[str, Any] | Exception | None] = queue.Queue()
        self.notifications: list[dict[str, Any]] = []
        self.stderr_chunks: list[bytes] = []
        self.stdout_thread = threading.Thread(target=self._read_stdout, daemon=True)
        self.stderr_thread = threading.Thread(target=self._read_stderr, daemon=True)
        self.stdout_thread.start()
        self.stderr_thread.start()

    @property
    def stderr(self) -> str:
        return b"".join(self.stderr_chunks).decode("utf-8", errors="replace")

    def _read_stdout(self) -> None:
        try:
            while line := self.process.stdout.readline():
                headers = {}
                while line != b"\r\n":
                    assert line.endswith(b"\r\n"), f"Non-LSP stdout: {line!r}"
                    name, separator, value = line[:-2].partition(b":")
                    assert separator, f"Non-LSP stdout header: {line!r}"
                    headers[name.lower()] = value.strip()
                    line = self.process.stdout.readline()
                    assert line, "EOF in LSP headers"
                length = int(headers[b"content-length"])
                assert length > 0, f"Invalid Content-Length: {length}"
                body = self.process.stdout.read(length)
                assert len(body) == length, "EOF in LSP body"
                message = json.loads(body.decode("utf-8"))
                assert isinstance(message, dict) and message.get("jsonrpc") == "2.0"
                self.messages.put(message)
        except Exception as exc:  # Report reader failures on the test thread.
            self.messages.put(exc)
        finally:
            self.messages.put(None)

    def _read_stderr(self) -> None:
        while chunk := self.process.stderr.read1(4096):
            self.stderr_chunks.append(chunk)

    def send(self, message: dict[str, Any]) -> None:
        body = json.dumps(message, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
        self.process.stdin.write(header + body)
        self.process.stdin.flush()

    def response(self, request_id: int) -> Any:
        deadline = time.monotonic() + TIMEOUT
        while True:
            remaining = deadline - time.monotonic()
            assert (
                remaining > 0
            ), f"Timed out awaiting response {request_id}\n{self.stderr}"
            try:
                message = self.messages.get(timeout=remaining)
            except queue.Empty as exc:
                raise AssertionError(
                    f"Timed out awaiting response {request_id}\n{self.stderr}"
                ) from exc
            assert message is not None, f"Server stdout closed early\n{self.stderr}"
            if isinstance(message, Exception):
                raise AssertionError(
                    f"Invalid server stdout: {message}\n{self.stderr}"
                ) from message
            if "id" not in message:
                assert "method" in message, message
                self.notifications.append(message)
                continue
            assert message["id"] == request_id, message
            assert "error" not in message, message
            return message["result"]

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        with contextlib.suppress(BrokenPipeError):
            self.process.stdin.close()
        self.stdout_thread.join(timeout=5)
        self.stderr_thread.join(timeout=5)
        assert not self.stdout_thread.is_alive(), "stdout reader did not finish"
        assert not self.stderr_thread.is_alive(), "stderr reader did not finish"
        self.process.stdout.close()
        self.process.stderr.close()

    def assert_protocol_complete(self) -> None:
        eof_received = False
        while not self.messages.empty():
            message = self.messages.get_nowait()
            if message is None:
                eof_received = True
            else:
                assert isinstance(message, dict), f"Invalid trailing stdout: {message}"
                assert "method" in message and "id" not in message, message
                self.notifications.append(message)
        assert eof_received, "stdout reader did not reach EOF"


def test_real_stdio_settings_and_lifecycle(tmp_path):
    root = tmp_path / "workspace café"
    root.mkdir()
    options = load_settings_fixture("producer", root)["initializationOptions"]
    client = _LspProcess(tmp_path)
    try:
        client.send(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "processId": None,
                    "rootUri": root.as_uri(),
                    "capabilities": {},
                    "initializationOptions": options,
                },
            }
        )
        result = client.response(1)
        assert isinstance(result["capabilities"], dict)
        client.send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        client.send(
            {"jsonrpc": "2.0", "id": 2, "method": "test/settings", "params": {}}
        )
        inspection = client.response(2)
        assert inspection["initialized"] is True
        assert (
            pathlib.Path(inspection["serverModule"]).resolve()
            == pathlib.Path(server_module.__file__).resolve()
        )
        assert inspection["globalSettings"] == options["globalSettings"]
        key = str(pathlib.Path(uris.to_fs_path(root.as_uri())))
        assert inspection["settings"] == {
            key: {**options["settings"][0], "workspaceFS": key}
        }

        client.send({"jsonrpc": "2.0", "id": 3, "method": "shutdown", "params": None})
        assert client.response(3) is None
        client.send({"jsonrpc": "2.0", "method": "exit", "params": None})
        assert client.process.wait(timeout=TIMEOUT) == 0
    finally:
        client.close()
        print(client.stderr, file=sys.stderr)

    client.assert_protocol_complete()
    assert any(
        message["method"] == "window/logMessage"
        and message["params"]["message"] == "fixture initialized"
        for message in client.notifications
    )
    assert "fixture shutdown complete" in client.stderr
    assert "fixture exit complete" in client.stderr
