# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Light-weight JSON-RPC over standard IO."""

from __future__ import annotations

import atexit
import contextlib
import json
import os
import subprocess
import threading
import uuid
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import BinaryIO

CONTENT_LENGTH = "Content-Length: "


class StreamClosedException(Exception):
    """JSON RPC stream is closed."""

    pass


class JsonWriter:
    """Manages writing JSON-RPC messages to the writer stream."""

    def __init__(self, writer: BinaryIO):
        self._writer = writer
        self._lock = threading.Lock()

    def close(self):
        """Closes the underlying writer stream."""
        with self._lock:
            if not self._writer.closed:
                self._writer.close()

    def write(self, data):
        """Writes given data to stream in JSON-RPC format."""
        if self._writer.closed:
            raise StreamClosedException()

        with self._lock:
            content = json.dumps(data)
            length = len(content.encode("utf-8"))
            self._writer.write(
                f"{CONTENT_LENGTH}{length}\r\n\r\n{content}".encode("utf-8")
            )
            self._writer.flush()


class JsonReader:
    """Manages reading JSON-RPC messages from stream."""

    def __init__(self, reader: BinaryIO):
        self._reader = reader

    def close(self):
        """Closes the underlying reader stream."""
        if not self._reader.closed:
            self._reader.close()

    def read(self):
        """Reads data from the stream in JSON-RPC format."""
        if self._reader.closed:
            raise StreamClosedException()
        length = None
        while not length:
            line = self._readline().decode("utf-8")
            if line.startswith(CONTENT_LENGTH):
                length = int(line[len(CONTENT_LENGTH):])  # noqa: E203

        line = self._readline().decode("utf-8").strip()
        while line:
            line = self._readline().decode("utf-8").strip()

        content = self._reader.read(length).decode("utf-8")
        return json.loads(content)

    def _readline(self):
        line = self._reader.readline()
        if not line:
            raise EOFError
        return line


class JsonRpc:
    """Manages sending and receiving data over JSON-RPC."""

    def __init__(self, reader: BinaryIO, writer: BinaryIO):
        self._reader = JsonReader(reader)
        self._writer = JsonWriter(writer)

    def close(self):
        """Closes the underlying streams."""
        with contextlib.suppress(Exception):
            self._reader.close()
        with contextlib.suppress(Exception):
            self._writer.close()

    def send_data(self, data):
        """Send given data in JSON-RPC format."""
        self._writer.write(data)

    def receive_data(self):
        """Receive data in JSON-RPC format."""
        return self._reader.read()


def create_json_rpc(readable: BinaryIO, writable: BinaryIO) -> JsonRpc:
    """Creates JSON-RPC wrapper for the readable and writable streams."""
    return JsonRpc(readable, writable)


# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------


class ProcessManager:
    """Manages sub-processes launched for running tools."""

    def __init__(self):
        self._processes: dict[str, subprocess.Popen] = {}
        self._rpc: dict[str, JsonRpc] = {}
        self._lock = threading.Lock()
        self._thread_pool = ThreadPoolExecutor(10)

    def stop_process(self, workspace: str) -> None:
        """Stop the process for the given workspace."""
        with self._lock:
            if workspace in self._processes:
                proc = self._processes[workspace]
                try:
                    proc.kill()
                    proc.wait(timeout=5)
                except Exception:
                    pass
                del self._processes[workspace]
            if workspace in self._rpc:
                rpc = self._rpc.pop(workspace)
                with contextlib.suppress(Exception):
                    rpc.close()

    def stop_all_processes(self):
        """Send exit command to all processes and shutdown transport."""
        with self._lock:
            rpcs = list(self._rpc.values())
        for rpc in rpcs:
            with contextlib.suppress(Exception):
                rpc.send_data({"id": str(uuid.uuid4()), "method": "exit"})
        self._thread_pool.shutdown(wait=False)

    def start_process(
        self,
        workspace: str,
        args: Sequence[str],
        cwd: str,
        env: dict[str, str] | None = None,
    ) -> None:
        """Starts a process and establishes JSON-RPC communication over stdio."""
        new_env = os.environ.copy()
        if env is not None:
            new_env.update(env)
        proc = subprocess.Popen(
            args,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            env=new_env,
        )
        with self._lock:
            self._processes[workspace] = proc
            self._rpc[workspace] = create_json_rpc(proc.stdout, proc.stdin)

        def _monitor_process():
            proc.wait()
            with self._lock:
                try:
                    del self._processes[workspace]
                    rpc = self._rpc.pop(workspace)
                    rpc.close()
                except Exception:
                    pass

        self._thread_pool.submit(_monitor_process)

    def get_json_rpc(self, workspace: str) -> JsonRpc:
        """Gets the JSON-RPC wrapper for a given workspace id."""
        with self._lock:
            if workspace in self._rpc:
                return self._rpc[workspace]
        raise StreamClosedException()


_process_manager = ProcessManager()
atexit.register(_process_manager.stop_all_processes)


def _get_json_rpc(workspace: str) -> JsonRpc | None:
    try:
        return _process_manager.get_json_rpc(workspace)
    except (StreamClosedException, KeyError):
        return None


def get_or_start_json_rpc(
    workspace: str,
    interpreter: Sequence[str],
    cwd: str,
    runner_script: str,
    env: dict[str, str] | None = None,
) -> JsonRpc | None:
    """Gets an existing JSON-RPC connection or starts one and return it."""
    res = _get_json_rpc(workspace)
    if not res:
        args = [*interpreter, runner_script]
        _process_manager.start_process(workspace, args, cwd, env)
        res = _get_json_rpc(workspace)
    return res


# ---------------------------------------------------------------------------
# RPC run helpers
# ---------------------------------------------------------------------------


@dataclass
class RpcRunResult:
    """Object to hold result from running tool over RPC."""

    stdout: str
    stderr: str
    exception: str | None = None


def run_over_json_rpc(
    workspace: str,
    interpreter: Sequence[str],
    module: str,
    argv: Sequence[str],
    use_stdin: bool,
    cwd: str,
    runner_script: str,
    source: str | None = None,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> RpcRunResult:
    """Uses JSON-RPC to execute a command."""
    rpc = get_or_start_json_rpc(
        workspace, interpreter, cwd, runner_script, env
    )
    if not rpc:
        raise ConnectionError("Failed to run over JSON-RPC.")

    msg_id = str(uuid.uuid4())
    msg = {
        "id": msg_id,
        "method": "run",
        "module": module,
        "argv": argv,
        "useStdin": use_stdin,
        "cwd": cwd,
    }
    if source:
        msg["source"] = source

    rpc.send_data(msg)

    if timeout is not None:
        result_container: list[object] = [None]
        error_container: list[BaseException | None] = [None]

        def _receive():
            try:
                result_container[0] = rpc.receive_data()
            except Exception as e:
                error_container[0] = e

        recv_thread = threading.Thread(target=_receive, daemon=True)
        recv_thread.start()
        recv_thread.join(timeout)
        if recv_thread.is_alive():
            _process_manager.stop_process(workspace)
            raise TimeoutError(
                f"JSON-RPC call timed out after {timeout}s"
            )
        if error_container[0] is not None:
            raise error_container[0]
        data = result_container[0]
    else:
        data = rpc.receive_data()

    if data["id"] != msg_id:
        return RpcRunResult(
            "", f"Invalid result for request: {json.dumps(msg, indent=4)}"
        )

    result = data.get("result", "")
    if "error" in data:
        error = data["error"]
        if data.get("exception", False):
            return RpcRunResult(result, "", error)
        return RpcRunResult(result, error)

    return RpcRunResult(result, "")


def shutdown_json_rpc():
    """Shutdown all JSON-RPC processes."""
    _process_manager.stop_all_processes()
