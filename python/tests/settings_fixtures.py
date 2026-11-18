# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Load the on-disk settings contract shared with the TypeScript tests."""

from __future__ import annotations

import json
import os
import pathlib
import sys
from typing import Any


def load_settings_fixture(name: str, root: pathlib.Path) -> dict[str, Any]:
    """Expand test-only path placeholders without changing payload values."""
    replacements = {
        "__ROOT_URI__": root.as_uri(),
        "__ROOT_FS__": str(root),
        "__CWD_FS__": os.getcwd(),
        "__PYTHON__": sys.executable,
        "__SEP__": os.sep,
    }

    def expand(value: Any) -> Any:
        if isinstance(value, str):
            for token, replacement in replacements.items():
                value = value.replace(token, replacement)
            return value
        if isinstance(value, list):
            return [expand(item) for item in value]
        if isinstance(value, dict):
            return {key: expand(item) for key, item in value.items()}
        return value

    fixture_path = (
        pathlib.Path(__file__).parent / "fixtures" / "settings" / f"{name}.json"
    )
    return expand(json.loads(fixture_path.read_text(encoding="utf-8")))
