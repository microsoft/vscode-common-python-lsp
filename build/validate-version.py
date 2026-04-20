#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Validate version consistency across VERSION, package.json, and pyproject.toml.

Exit 0 if all match, exit 1 on mismatch. Optionally pass a tag (e.g. v0.2.0)
to also verify it matches.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_versions() -> dict[str, str]:
    pkg = json.loads((ROOT / "typescript/package.json").read_text())
    toml = (ROOT / "python/pyproject.toml").read_text()
    m = re.search(r'^version\s*=\s*"([^"]+)"', toml, re.MULTILINE)
    return {
        "VERSION": (ROOT / "VERSION").read_text().strip(),
        "package.json": pkg["version"],
        "pyproject.toml": m.group(1) if m else "NOT_FOUND",
    }


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
        print(f"Fix: python scripts/sync-version.py {reference}")
        sys.exit(1)

    print(f"\nAll versions consistent: {reference}")


if __name__ == "__main__":
    main()

