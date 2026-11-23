# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import pathlib
import shutil
import subprocess
import sys

import vscode_common_python_lsp


def test_package_importable():
    """Verify the package is importable."""
    assert hasattr(vscode_common_python_lsp, "classify_python_file")


def test_noneditable_target_install(tmp_path):
    """Build from clean sources and execute the installed target, not this checkout."""
    python_root = pathlib.Path(__file__).resolve().parents[1]
    source = tmp_path / "source"
    source.mkdir()
    for name in ("pyproject.toml", "README.md"):
        shutil.copy2(python_root / name, source / name)
    shutil.copytree(
        python_root / "vscode_common_python_lsp",
        source / "vscode_common_python_lsp",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    target = tmp_path / "bundled" / "libs"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "--disable-pip-version-check",
            "install",
            "--target",
            str(target),
            "--no-deps",
            "--no-cache-dir",
            "--no-build-isolation",
            "--upgrade",
            str(source),
        ],
        cwd=tmp_path,
        check=True,
        timeout=120,
    )
    subprocess.run(
        [
            sys.executable,
            "-I",
            str(pathlib.Path(__file__).parent / "fixtures" / "bundled_smoke.py"),
            str(target),
        ],
        cwd=tmp_path,
        check=True,
        timeout=20,
    )
