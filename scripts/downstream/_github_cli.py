#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""GitHub CLI helpers for downstream automation scripts."""

from __future__ import annotations

import re
import subprocess


def run_gh(args: list[str]) -> str:
    cmd = ["gh", *args]
    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "").strip()
        stdout = (exc.stdout or "").strip()
        details = stderr or stdout or str(exc)
        raise RuntimeError(f"gh command failed: {' '.join(cmd)}\n{details}") from exc


def parse_trailing_number(url: str, pattern: str, label: str) -> int:
    match = re.search(pattern, url)
    if not match:
        raise ValueError(f"Could not parse {label} number from output: {url}")
    return int(match.group(1))
