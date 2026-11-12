# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Build and verify paired shared runtimes from an explicitly selected source."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUTS = (
    "typescript/src",
    "typescript/package.json",
    "typescript/package-lock.json",
    "typescript/tsconfig.json",
    "python/vscode_common_python_lsp",
    "python/pyproject.toml",
    "python/README.md",
)


def run(args: list[str], cwd: Path, **kwargs) -> subprocess.CompletedProcess:
    """Run a tool without a shell (including npm.cmd on Windows)."""
    executable = shutil.which(args[0]) or args[0]
    return subprocess.run([executable, *args[1:]], cwd=cwd, check=True, **kwargs)


def git(root: Path, *args: str) -> str:
    return run(
        ["git", *args], root, stdout=subprocess.PIPE, encoding="utf-8"
    ).stdout.strip()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fingerprint(files: dict[str, str]) -> str:
    return hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def source_identity(
    root: Path, expected_commit: str, allow_dirty: bool = False
) -> dict:
    root = root.resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", expected_commit):
        raise ValueError("Expected commit must be a full lowercase Git SHA")
    if Path(git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        raise ValueError("Source root must be the shared Git checkout, not a child")
    commit = git(root, "rev-parse", "HEAD")
    if commit != expected_commit:
        raise ValueError(f"Shared source pin mismatch: {commit} != {expected_commit}")
    dirty = bool(git(root, "status", "--porcelain", "--untracked-files=normal"))
    paths = git(
        root,
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        *INPUTS,
    ).split("\0")
    files = {}
    for name in sorted(set(filter(None, paths))):
        path = root / name
        if path.is_symlink():
            raise ValueError(f"Symlink build input is not supported: {name}")
        if path.is_file():
            files[name] = digest(path)
    for required in ("typescript/src/index.ts", "python/pyproject.toml"):
        if required not in files:
            raise ValueError(f"Missing shared build input: {required}")
    if not dirty:
        committed = {}
        for entry in filter(
            None, git(root, "ls-tree", "-r", "-z", "HEAD", "--", *INPUTS).split("\0")
        ):
            metadata, name = entry.split("\t", 1)
            committed[name] = metadata.split()[-1]
        # Ignore index shortcuts, but preserve Git's clean/line-ending filters.
        blobs = git(root, "hash-object", "--", *files).splitlines()
        dirty = dict(zip(files, blobs, strict=True)) != committed
    if dirty and not allow_dirty:
        raise ValueError("Dirty shared checkout; explicitly pass --allow-dirty")
    return {
        "commit": commit,
        "dirty": dirty,
        "inputFingerprint": fingerprint(files),
        "inputs": files,
    }


def artifact_files(output: Path) -> dict[str, str]:
    unexpected = {path.name for path in output.iterdir()} - {
        "typescript",
        "wheels",
        "provenance.json",
    }
    if unexpected:
        raise ValueError(f"Unexpected artifact entries: {sorted(unexpected)}")
    files = {}
    for folder in ("typescript", "wheels"):
        directory = output / folder
        if not directory.is_dir():
            raise ValueError(f"Missing artifact directory: {directory}")
        for path in sorted(directory.rglob("*")):
            if path.is_symlink():
                raise ValueError(f"Symlink artifact is not supported: {path}")
            if path.is_file():
                files[path.relative_to(output).as_posix()] = digest(path)
    if "typescript/dist/index.js" not in files:
        raise ValueError("Missing compiled TypeScript entry point")
    if len(list((output / "wheels").glob("*.whl"))) != 1:
        raise ValueError("Expected exactly one shared Python wheel")
    return files


def verify(
    root: Path, output: Path, expected_commit: str, allow_dirty: bool = False
) -> dict:
    manifest = json.loads((output / "provenance.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != 1:
        raise ValueError("Unknown source-build manifest schema")
    current = source_identity(root, expected_commit, allow_dirty)
    if current != manifest["source"]:
        raise ValueError("Source changed since build (pin, dirty state or inputs)")
    if artifact_files(output) != manifest["artifacts"]:
        raise ValueError("Artifact contents changed since build")
    return manifest


def build(
    root: Path, output: Path, expected_commit: str, allow_dirty: bool = False
) -> dict:
    root, output = root.resolve(), output.resolve()
    identity = source_identity(root, expected_commit, allow_dirty)
    if output.exists():
        raise ValueError(f"Refusing to reuse existing build destination: {output}")
    output.mkdir(parents=True)
    work = output / ".build"
    snapshot = work / "source"
    for name in identity["inputs"]:
        target = snapshot / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, target)
    # Hash the copied bytes too: a concurrent source edit cannot get a clean stamp.
    if {name: digest(snapshot / name) for name in identity["inputs"]} != (
        identity["inputs"]
    ):
        raise ValueError("Source changed while taking build snapshot")
    run(["npm", "ci", "--no-audit", "--no-fund"], snapshot / "typescript")
    run(["npm", "run", "build"], snapshot / "typescript")
    (output / "typescript").mkdir()
    shutil.copyfile(
        snapshot / "typescript/package.json", output / "typescript/package.json"
    )
    shutil.copytree(snapshot / "typescript/dist", output / "typescript/dist")
    (output / "wheels").mkdir()
    run(
        [
            sys.executable,
            "-c",
            "from setuptools.build_meta import build_wheel; "
            "import sys; build_wheel(sys.argv[1])",
            str(output / "wheels"),
        ],
        snapshot / "python",
    )
    if identity != source_identity(root, expected_commit, allow_dirty):
        raise ValueError("Source changed during build")
    if {name: digest(snapshot / name) for name in identity["inputs"]} != (
        identity["inputs"]
    ):
        raise ValueError("Snapshot inputs changed during build")
    shutil.rmtree(work)
    manifest = {
        "schema": 1,
        "sourceRoot": str(root),
        "source": identity,
        "toolchain": {
            "python": sys.version,
            "setuptools": importlib.metadata.version("setuptools"),
            "wheel": importlib.metadata.version("wheel"),
            "node": run(
                ["node", "--version"], root, stdout=subprocess.PIPE, text=True
            ).stdout.strip(),
            "npm": run(
                ["npm", "--version"], root, stdout=subprocess.PIPE, text=True
            ).stdout.strip(),
        },
        "artifacts": artifact_files(output),
    }
    (output / "provenance.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    verify(root, output, expected_commit, allow_dirty)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("build", "verify"))
    parser.add_argument("--source-root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--allow-dirty", action="store_true")
    args = parser.parse_args()
    operation = build if args.operation == "build" else verify
    result = operation(
        args.source_root, args.output, args.expected_commit, args.allow_dirty
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
