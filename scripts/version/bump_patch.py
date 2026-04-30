#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Bump the patch version and synchronize all package manifests.

Usage:
    python -m scripts.version.bump_patch
"""

from __future__ import annotations

import sys

from . import SEMVER_RE, VERSION_FILE
from .sync import main as sync_manifests


def main() -> None:
    current = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not SEMVER_RE.match(current):
        print(f"ERROR: VERSION file contains invalid semver: '{current}'")
        sys.exit(1)

    major, minor, patch = current.split(".")
    new_version = f"{major}.{minor}.{int(patch) + 1}"

    VERSION_FILE.write_text(new_version + "\n", encoding="utf-8")
    print(f"VERSION bumped: {current} -> {new_version}")

    # Propagate to package.json, pyproject.toml, and package-lock.json
    sync_manifests()


if __name__ == "__main__":
    main()
