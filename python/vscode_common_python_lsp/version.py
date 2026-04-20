# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tool version detection and validation."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from typing import TypeAlias

from packaging.version import InvalidVersion, parse


def extract_version(
    stdout: str | None,
    *,
    parser: Callable[[str], str | None] | None = None,
) -> str | None:
    """Extract a version string from tool ``--version`` output.

    Parameters
    ----------
    stdout:
        The tool's stdout (typically from running ``<tool> --version``).
        May be *None* or empty — returns *None* in that case.
    parser:
        Optional callable that receives the full stdout and returns a
        version string.  When *None* the first ``\\d+\\.\\d+`` match in the
        first non-empty line is returned.
    """
    if not stdout or not stdout.strip():
        return None

    if parser is not None:
        return parser(stdout)

    first_line = next((line for line in stdout.splitlines() if line.strip()), "")
    match = re.search(r"\d+\.\d+\S*", first_line)
    return match.group(0) if match else None


def check_min_version(actual: str, minimum: str) -> bool:
    """Return *True* when *actual* ≥ *minimum*.

    Uses :func:`packaging.version.parse` for PEP 440 comparison.
    """
    try:
        return parse(actual) >= parse(minimum)
    except InvalidVersion:
        logging.warning(
            "Invalid version string: actual=%r, minimum=%r", actual, minimum
        )
        return False


VersionInfo: TypeAlias = tuple[int, int, int]
"""(major, minor, micro) tuple stored per-workspace."""


def version_to_tuple(version_str: str) -> VersionInfo:
    """Convert a version string to a ``(major, minor, micro)`` tuple."""
    v = parse(version_str)
    return (v.major, v.minor, v.micro)
