#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Set and synchronize the version across all package manifests.

Usage:
    python -m scripts.version.sync              # propagate VERSION → manifests
    python -m scripts.version.sync 0.2.0        # set VERSION to 0.2.0, then propagate
"""

from __future__ import annotations

import re
import subprocess
import sys

from . import PACKAGE_JSON, PYPROJECT_TOML, SEMVER_RE, VERSION_FILE


def main() -> None:
    if len(sys.argv) > 1:
        version = sys.argv[1]
        if not SEMVER_RE.match(version):
            print(f"ERROR: '{version}' is not valid semver (X.Y.Z)")
            sys.exit(1)
        VERSION_FILE.write_text(version + "\n", encoding="utf-8")
        print(f"VERSION set to {version}")
    else:
        version = VERSION_FILE.read_text(encoding="utf-8").strip()

    changed = []

    # package.json — regex replacement to preserve formatting
    pkg_text = PACKAGE_JSON.read_text(encoding="utf-8")
    new_pkg_text = re.sub(
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{version}\2",
        pkg_text,
        count=1,
    )
    if new_pkg_text != pkg_text:
        PACKAGE_JSON.write_text(new_pkg_text, encoding="utf-8")
        changed.append("package.json")
        # Keep package-lock.json in sync
        subprocess.run(
            ["npm", "install", "--package-lock-only"],
            cwd=PACKAGE_JSON.parent,
            check=True,
            shell=(sys.platform == "win32"),
        )
        changed.append("package-lock.json")

    # pyproject.toml
    content = PYPROJECT_TOML.read_text(encoding="utf-8")
    new_content = re.sub(
        r'^(version\s*=\s*")[^"]+(")',
        rf"\g<1>{version}\2",
        content,
        count=1,
        flags=re.MULTILINE,
    )
    if new_content != content:
        PYPROJECT_TOML.write_text(new_content, encoding="utf-8")
        changed.append("pyproject.toml")

    if changed:
        print(f"Updated: {', '.join(changed)}")
    else:
        print("All manifests already at the correct version.")


if __name__ == "__main__":
    main()
