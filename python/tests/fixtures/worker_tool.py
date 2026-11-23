# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Deterministic tool for real worker transport tests."""

import json
import os
import sys

if __name__ == "__main__":
    if "--fail" in sys.argv:
        raise RuntimeError("worker tool failure")
    print(
        json.dumps(
            {
                "pid": os.getpid(),
                "executable": sys.executable,
                "cwd": os.getcwd(),
                "argv": sys.argv,
                "source": sys.stdin.read(),
            }
        )
    )
    print("worker tool stderr", file=sys.stderr)
