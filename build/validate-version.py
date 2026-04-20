#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Validate that the git tag version matches all package manifests.

Called by azure-pipelines-release.yml during the Validate stage.

Expects:
    BUILD_SOURCEBRANCH env var (e.g. ``refs/tags/v0.2.0``)

Outputs:
    Sets the ``ReleaseVersion`` Azure Pipelines variable.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _read_version_file() -> str:
    return (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()


def _read_package_json_version() -> str:
    data = json.loads(
        (REPO_ROOT / "typescript" / "package.json").read_text(encoding="utf-8")
    )
    return data["version"]


def _read_pyproject_version() -> str:
    content = (REPO_ROOT / "python" / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    return m.group(1) if m else "NOT_FOUND"


def main() -> None:
    source_branch = os.environ.get("BUILD_SOURCEBRANCH", "")
    if not source_branch.startswith("refs/tags/v"):
        print(f"ERROR: BUILD_SOURCEBRANCH '{source_branch}' is not a version tag")
        sys.exit(1)

    tag_version = source_branch.removeprefix("refs/tags/v")
    file_version = _read_version_file()
    pkg_version = _read_package_json_version()
    pyproject_version = _read_pyproject_version()

    print(f"Tag version:            {tag_version}")
    print(f"VERSION file:           {file_version}")
    print(f"package.json version:   {pkg_version}")
    print(f"pyproject.toml version: {pyproject_version}")

    errors = 0
    pairs = [
        ("VERSION file", file_version),
        ("package.json", pkg_version),
        ("pyproject.toml", pyproject_version),
    ]
    for label, version in pairs:
        if tag_version != version:
            print(
                f"##vso[task.logissue type=error]"
                f"Tag ({tag_version}) != {label} ({version})"
            )
            errors += 1

    if errors:
        print(
            f"##vso[task.logissue type=error]"
            f"Version mismatch. Run 'python scripts/sync-version.py {tag_version}' and push."
        )
        sys.exit(1)

    print(
        f"##vso[task.setvariable variable=ReleaseVersion;isOutput=true]{tag_version}"
    )
    print(f"✅ All versions consistent: {tag_version}")


if __name__ == "__main__":
    main()
