#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""GitHub Actions output helpers for downstream automation scripts."""

from __future__ import annotations

import json
import os


def write_block_and_json_output(block_name: str, json_name: str, lines: list[str], payload: object) -> None:
    output_path = os.getenv("GITHUB_OUTPUT")
    if not output_path:
        return

    with open(output_path, "a", encoding="utf-8") as f:
        f.write(f"{block_name}<<EOF\n")
        if lines:
            f.write("\n".join(lines))
            f.write("\n")
        f.write("EOF\n")
        f.write(f"{json_name}={json.dumps(payload, separators=(',', ':'))}\n")
