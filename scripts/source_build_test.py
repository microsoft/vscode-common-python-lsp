# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Regression tests for source identity and artifact consumption checks."""

import json
import tempfile
import unittest
from pathlib import Path

import source_build as build


class SourceBuildTests(unittest.TestCase):
    def setUp(self):
        staging = build.ROOT / "test-submodules"
        staging.mkdir(exist_ok=True)
        self.workspace = tempfile.TemporaryDirectory(
            prefix="source-build-", dir=staging
        )
        self.addCleanup(self.workspace.cleanup)
        self.root = Path(self.workspace.name)
        build.git(self.root, "init", "--quiet")
        for name, content in {
            ".gitignore": "artifacts/\n",
            "typescript/src/index.ts": "export const value = 1;\n",
            "python/pyproject.toml": "[project]\nname = 'fixture'\n",
            "python/vscode_common_python_lsp/__init__.py": "VALUE = 1\n",
        }.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        build.git(self.root, "add", ".")
        build.git(
            self.root,
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Fixture",
        )
        self.commit = build.git(self.root, "rev-parse", "HEAD")
        self.output = self.root / "artifacts"
        (self.output / "typescript/dist").mkdir(parents=True)
        (self.output / "typescript/dist/index.js").write_text("value = 1;\n")
        (self.output / "wheels").mkdir()
        (self.output / "wheels/shared.whl").write_bytes(b"fixture artifact")
        self.manifest = {
            "schema": 1,
            "source": build.source_identity(self.root, self.commit),
            "artifacts": build.artifact_files(self.output),
        }
        self.write_manifest()

    def write_manifest(self):
        (self.output / "provenance.json").write_text(
            json.dumps(self.manifest), encoding="utf-8"
        )

    def test_clean_build_identity_and_existing_destination(self):
        self.assertEqual(
            build.verify(self.root, self.output, self.commit), self.manifest
        )
        with self.assertRaisesRegex(ValueError, "reuse existing"):
            build.build(self.root, self.output, self.commit)

    def test_dirty_source_is_not_a_clean_commit(self):
        source = self.root / "typescript/src/index.ts"
        source.write_text("export const value = 2;\n")
        with self.assertRaisesRegex(ValueError, "Dirty shared"):
            build.source_identity(self.root, self.commit)
        identity = build.source_identity(self.root, self.commit, allow_dirty=True)
        self.assertTrue(identity["dirty"])
        self.assertEqual(identity["commit"], self.commit)
        self.assertNotEqual(
            identity["inputFingerprint"],
            self.manifest["source"]["inputFingerprint"],
        )
        with self.assertRaisesRegex(ValueError, "Source changed"):
            build.verify(self.root, self.output, self.commit, allow_dirty=True)

    def test_hidden_runtime_edits_cannot_claim_a_clean_commit(self):
        source = self.root / "python/vscode_common_python_lsp/__init__.py"
        name = source.relative_to(self.root).as_posix()
        original = source.read_bytes()
        for flag in ("assume-unchanged", "skip-worktree"):
            for operation in ("edit", "remove"):
                with self.subTest(flag=flag, operation=operation):
                    build.git(self.root, "update-index", f"--{flag}", "--", name)
                    try:
                        if operation == "remove":
                            source.unlink()
                        else:
                            source.write_bytes(b"VALUE = 2\n")
                        with self.assertRaisesRegex(ValueError, "Dirty shared"):
                            build.source_identity(self.root, self.commit)
                        identity = build.source_identity(
                            self.root, self.commit, allow_dirty=True
                        )
                        self.assertTrue(identity["dirty"])
                        self.assertNotEqual(
                            identity["inputFingerprint"],
                            self.manifest["source"]["inputFingerprint"],
                        )
                    finally:
                        source.write_bytes(original)
                        build.git(self.root, "update-index", f"--no-{flag}", "--", name)

    def test_clean_line_endings_use_git_normalization(self):
        build.git(self.root, "config", "core.autocrlf", "true")
        source = self.root / "python/vscode_common_python_lsp/__init__.py"
        source.write_bytes(b"VALUE = 1\r\n")
        identity = build.source_identity(self.root, self.commit)
        self.assertFalse(identity["dirty"])

    def test_source_removal_and_untracked_addition_invalidate_artifacts(self):
        (self.root / "typescript/src/index.ts").write_text("export const value = 2;\n")
        self.manifest["source"] = build.source_identity(
            self.root, self.commit, allow_dirty=True
        )
        self.write_manifest()
        source = self.root / "python/vscode_common_python_lsp/__init__.py"
        source.unlink()
        with self.assertRaisesRegex(ValueError, "Source changed"):
            build.verify(self.root, self.output, self.commit, allow_dirty=True)
        build.git(self.root, "restore", "--", str(source.relative_to(self.root)))
        source.with_name("new.py").write_text("NEW = True\n")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            build.verify(self.root, self.output, self.commit, allow_dirty=True)

    def test_wrong_pin_and_consumer_ancestor_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "pin mismatch"):
            build.verify(self.root, self.output, "0" * 40)
        with self.assertRaisesRegex(ValueError, "not a child"):
            build.source_identity(self.root / "typescript", self.commit)

    def test_artifact_tampering_missing_extra_and_mixed_python(self):
        for name, operation in (
            ("typescript/dist/index.js", "edit"),
            ("typescript/dist/index.js", "remove"),
            ("typescript/dist/obsolete.js", "extra"),
            ("unexpected.js", "extra"),
            ("wheels/shared.whl", "edit"),
        ):
            with self.subTest(name=name, operation=operation):
                path = self.output / name
                original = path.read_bytes() if path.exists() else None
                if operation == "remove":
                    path.unlink()
                else:
                    path.write_bytes(b"not the recorded build")
                with self.assertRaises(ValueError):
                    build.verify(self.root, self.output, self.commit)
                if original is None:
                    path.unlink()
                else:
                    path.write_bytes(original)

    def test_dirty_fingerprint_is_bound_to_both_artifacts(self):
        source = self.root / "typescript/src/index.ts"
        source.write_text("export const value = 3;\n")
        self.manifest["source"] = build.source_identity(
            self.root, self.commit, allow_dirty=True
        )
        self.write_manifest()
        build.verify(self.root, self.output, self.commit, allow_dirty=True)
        source.write_text("export const value = 4;\n")
        with self.assertRaisesRegex(ValueError, "Source changed"):
            build.verify(self.root, self.output, self.commit, allow_dirty=True)


if __name__ == "__main__":
    unittest.main()
