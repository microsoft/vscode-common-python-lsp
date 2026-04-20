# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Shared version utilities for the vscode-common-python-lsp monorepo."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
VERSION_FILE = ROOT / "VERSION"
PACKAGE_JSON = ROOT / "typescript" / "package.json"
PYPROJECT_TOML = ROOT / "python" / "pyproject.toml"

SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_versions() -> dict[str, str]:
    """Read version strings from all manifest files."""
    pkg = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    toml = PYPROJECT_TOML.read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', toml, re.MULTILINE)
    return {
        "VERSION": VERSION_FILE.read_text(encoding="utf-8").strip(),
        "package.json": pkg["version"],
        "pyproject.toml": m.group(1) if m else "NOT_FOUND",
    }
