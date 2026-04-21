#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Validate version consistency across VERSION, package.json, and pyproject.toml.

Usage:
    python -m scripts.version.validate              # verify manifests match VERSION
    python -m scripts.version.validate v0.2.0       # also verify against a git tag
"""

from __future__ import annotations

import os
import sys

from . import read_versions


def main() -> None:
    versions = read_versions()
    tag = sys.argv[1].removeprefix("v") if len(sys.argv) > 1 else None
    reference = tag or versions["VERSION"]

    for source, value in versions.items():
        status = "✅" if value == reference else "❌"
        print(f"  {status} {source}: {value}")
    if tag:
        print(f"  🏷️  tag: {tag}")

    mismatches = [s for s, v in versions.items() if v != reference]
    if mismatches:
        print(f"\nVersion mismatch in: {', '.join(mismatches)}")
        print()
        print("To fix, run:")
        print(f"  python -m scripts.version.sync {reference}")
        print()
        print("This updates VERSION, package.json, and pyproject.toml to match.")
        sys.exit(1)

    # Set output variable for Azure Pipelines
    if os.environ.get("TF_BUILD"):
        print(
            f"##vso[task.setvariable variable=ReleaseVersion;isOutput=true]{reference}"
        )

    print(f"\nAll versions consistent: {reference}")


if __name__ == "__main__":
    main()
