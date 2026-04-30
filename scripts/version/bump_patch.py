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

# NOTE: sync.main() reads the version from VERSION_FILE (the else branch in
# sync.py) when sys.argv has no extra arguments, which is the case here.
from .sync import main as sync_manifests


def main() -> None:
    current = VERSION_FILE.read_text(encoding="utf-8").strip()
    match = SEMVER_RE.fullmatch(current)
    if not match:
        print(f"ERROR: VERSION file contains invalid semver: '{current}'", file=sys.stderr)
        sys.exit(1)

    major, minor, patch = match.group(1, 2, 3)
    new_version = f"{major}.{minor}.{int(patch) + 1}"

    VERSION_FILE.write_text(new_version + "\n", encoding="utf-8")
    print(f"VERSION bumped: {current} -> {new_version}")

    # Propagate to package.json, pyproject.toml, and package-lock.json
    try:
        sync_manifests()
    except Exception:
        # Restore original version to avoid inconsistent state
        VERSION_FILE.write_text(current + "\n", encoding="utf-8")
        print("ERROR: sync failed, restored original VERSION", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
