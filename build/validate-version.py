#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Validate version consistency across VERSION, package.json, and pyproject.toml.

Used by both GitHub Actions (PR check) and Azure Pipelines (release validation).

Usage:
    python build/validate-version.py                  # PR check: manifests match VERSION
    python build/validate-version.py --tag v0.2.0     # Release: also verify tag matches

CI platform is auto-detected for error annotation format. Override with --ci=github|azp.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


# -- version readers ----------------------------------------------------------


def read_version_file() -> str:
    return (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()


def read_package_json_version() -> str:
    data = json.loads(
        (REPO_ROOT / "typescript" / "package.json").read_text(encoding="utf-8")
    )
    return data["version"]


def read_pyproject_version() -> str:
    content = (REPO_ROOT / "python" / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    return m.group(1) if m else "NOT_FOUND"


# -- CI-aware logging ---------------------------------------------------------


def _detect_ci() -> str:
    if os.environ.get("GITHUB_ACTIONS"):
        return "github"
    if os.environ.get("TF_BUILD"):
        return "azp"
    return "local"


def log_error(msg: str, ci: str) -> None:
    if ci == "github":
        print(f"::error::{msg}")
    elif ci == "azp":
        print(f"##vso[task.logissue type=error]{msg}")
    else:
        print(f"ERROR: {msg}")


def log_warning(msg: str, ci: str) -> None:
    if ci == "github":
        print(f"::warning::{msg}")
    elif ci == "azp":
        print(f"##vso[task.logissue type=warning]{msg}")
    else:
        print(f"WARNING: {msg}")


def set_output(name: str, value: str, ci: str) -> None:
    if ci == "azp":
        print(f"##vso[task.setvariable variable={name};isOutput=true]{value}")
    elif ci == "github":
        github_output = os.environ.get("GITHUB_OUTPUT", "")
        if github_output:
            with open(github_output, "a", encoding="utf-8") as f:
                f.write(f"{name}={value}\n")


# -- main ---------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tag",
        help="Git tag to validate against (e.g. v0.2.0). "
        "If not provided, reads BUILD_SOURCEBRANCH env var as fallback.",
    )
    parser.add_argument(
        "--ci",
        choices=["github", "azp", "local"],
        default=None,
        help="CI platform for annotation format (auto-detected if omitted).",
    )
    args = parser.parse_args()
    ci = args.ci or _detect_ci()

    # Read all version sources
    file_version = read_version_file()
    pkg_version = read_package_json_version()
    pyproject_version = read_pyproject_version()

    # Resolve tag version (if in release mode)
    tag_version: str | None = None
    if args.tag:
        tag_version = args.tag.removeprefix("v")
    else:
        source_branch = os.environ.get("BUILD_SOURCEBRANCH", "")
        if source_branch.startswith("refs/tags/v"):
            tag_version = source_branch.removeprefix("refs/tags/v")

    # Print summary
    if tag_version:
        print(f"Tag version:            {tag_version}")
    print(f"VERSION file:           {file_version}")
    print(f"package.json version:   {pkg_version}")
    print(f"pyproject.toml version: {pyproject_version}")

    errors = 0

    # Validate semver format
    if not SEMVER_RE.match(file_version):
        log_error(f"VERSION '{file_version}' is not valid semver (X.Y.Z)", ci)
        errors += 1

    # Check manifests match VERSION file
    reference = tag_version or file_version
    pairs = [
        ("VERSION file", file_version),
        ("package.json", pkg_version),
        ("pyproject.toml", pyproject_version),
    ]
    for label, version in pairs:
        if reference != version:
            log_error(f"Expected {reference} but {label} has {version}", ci)
            errors += 1

    # Check CHANGELOG has an entry
    changelog = REPO_ROOT / "CHANGELOG.md"
    if changelog.exists():
        content = changelog.read_text(encoding="utf-8")
        if f"## [{file_version}]" not in content:
            log_warning(f"CHANGELOG.md has no entry for version {file_version}", ci)

    if errors:
        log_error(
            f"Run 'python scripts/sync-version.py {reference}' to fix.", ci
        )
        sys.exit(1)

    set_output("ReleaseVersion", reference, ci)
    print(f"✅ All versions consistent: {reference}")


if __name__ == "__main__":
    main()

