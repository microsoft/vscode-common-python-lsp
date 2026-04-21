# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Shared version utilities for the vscode-common-python-lsp monorepo."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    tomllib = None  # type: ignore[assignment]

ROOT = Path(__file__).resolve().parent.parent.parent
VERSION_FILE = ROOT / "VERSION"
PACKAGE_JSON = ROOT / "typescript" / "package.json"
PYPROJECT_TOML = ROOT / "python" / "pyproject.toml"

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_versions() -> dict[str, str]:
    """Read version strings from all manifest files."""
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))

    if tomllib is not None:
        with PYPROJECT_TOML.open("rb") as f:
            toml_data = tomllib.load(f)
        toml_version = toml_data.get("project", {}).get("version", "NOT_FOUND")
    else:
        # Fallback regex for Python < 3.11 without tomllib
        toml_text = PYPROJECT_TOML.read_text(encoding="utf-8")
        m = re.search(r'^version\s*=\s*"([^"]+)"', toml_text, re.MULTILINE)
        toml_version = m.group(1) if m else "NOT_FOUND"

    return {
        "VERSION": VERSION_FILE.read_text(encoding="utf-8").strip(),
        "package.json": pkg["version"],
        "pyproject.toml": toml_version,
    }
