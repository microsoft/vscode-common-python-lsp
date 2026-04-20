#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Synchronize the version from the root VERSION file into package manifests.

Usage:
    python scripts/sync-version.py          # sync VERSION → manifests
    python scripts/sync-version.py 0.2.0    # set VERSION to 0.2.0, then sync
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = REPO_ROOT / "VERSION"
PACKAGE_JSON = REPO_ROOT / "typescript" / "package.json"
PYPROJECT_TOML = REPO_ROOT / "python" / "pyproject.toml"

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_version() -> str:
    """Read and validate the version from the VERSION file."""
    version = VERSION_FILE.read_text(encoding="utf-8").strip()
    if not SEMVER_RE.match(version):
        print(f"ERROR: '{version}' in VERSION is not valid semver (X.Y.Z)")
        sys.exit(1)
    return version


def write_version(version: str) -> None:
    """Write a new version to the VERSION file."""
    if not SEMVER_RE.match(version):
        print(f"ERROR: '{version}' is not valid semver (X.Y.Z)")
        sys.exit(1)
    VERSION_FILE.write_text(version + "\n", encoding="utf-8")


def sync_package_json(version: str) -> bool:
    """Update typescript/package.json version. Returns True if changed."""
    data = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    if data.get("version") == version:
        return False
    data["version"] = version
    PACKAGE_JSON.write_text(
        json.dumps(data, indent=4) + "\n", encoding="utf-8"
    )
    return True


def sync_pyproject_toml(version: str) -> bool:
    """Update python/pyproject.toml version. Returns True if changed."""
    content = PYPROJECT_TOML.read_text(encoding="utf-8")
    new_content = re.sub(
        r'^(version\s*=\s*")[^"]+(")',
        rf"\g<1>{version}\2",
        content,
        count=1,
        flags=re.MULTILINE,
    )
    if new_content == content:
        return False
    PYPROJECT_TOML.write_text(new_content, encoding="utf-8")
    return True


def main() -> None:
    if len(sys.argv) > 1:
        new_version = sys.argv[1]
        write_version(new_version)
        print(f"VERSION set to {new_version}")

    version = read_version()
    print(f"Syncing version {version} to package manifests...")

    changed = []
    if sync_package_json(version):
        changed.append("typescript/package.json")
    if sync_pyproject_toml(version):
        changed.append("python/pyproject.toml")

    if changed:
        print(f"Updated: {', '.join(changed)}")
    else:
        print("All manifests already at the correct version.")


if __name__ == "__main__":
    main()
