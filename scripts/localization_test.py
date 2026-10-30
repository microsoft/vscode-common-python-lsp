# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

"""Dependency-free localization core and Git submission regression tests."""

import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest import mock

import localization


class LocalizationTests(unittest.TestCase):
    """Exercise generic exports and fully staged, translation-ready imports."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="shared localization ")
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name).resolve()
        self.root = self.base / "extension"
        self.root.mkdir()
        (self.root / "src").mkdir()
        self.output = self.base / "staging"
        self.translations = self.base / "handbacks"
        self.translations.mkdir()
        self.configure()
        self.bad_json = None
        self.cli = mock.patch.object(localization, "run_cli", side_effect=self.run_cli)
        self.calls = self.cli.start()
        self.addCleanup(self.cli.stop)

    def configure(self, name="tool", runtime="./l10n"):
        package = {"publisher": "ms-python", "name": name}
        if runtime is not None:
            package["l10n"] = runtime
        (self.root / "package.json").write_text(json.dumps(package), encoding="utf-8")
        (self.root / "package.nls.json").write_text(
            '{"description":"English source"}\n', encoding="utf-8"
        )

    def handbacks(self, *, runtime=True, untranslated=None, same=False, state="new"):
        extension_id, _ = localization.metadata(self.root)
        files = []
        for locale in localization.LOCALES:
            folder = self.translations / locale
            folder.mkdir(exist_ok=True)
            path = folder / f"{extension_id}-new.xlf"
            document = ET.Element(
                "xliff",
                {"xmlns": "urn:oasis:names:tc:xliff:document:1.2", "version": "1.2"},
            )
            language = {"zh-cn": "zh-Hans", "zh-tw": "zh-Hant"}.get(locale, locale)
            for kind in (("package", "bundle") if runtime else ("package",)):
                table = ET.SubElement(
                    document, "file", {"original": kind, "target-language": language}
                )
                body = ET.SubElement(table, "body")
                for index in range(2):
                    unit = ET.SubElement(body, "trans-unit", {"id": str(index)})
                    ET.SubElement(unit, "source").text = f"English {index}"
                    target = ET.SubElement(unit, "target", {"state": state})
                    target.text = (
                        f"English {index}"
                        if same or untranslated == (locale, kind) or index == 1
                        else f"{locale} translation"
                    )
            ET.ElementTree(document).write(path, encoding="utf-8", xml_declaration=True)
            files.append(path)
        return files

    def run_cli(self, root, operation, _flag, output, *inputs):
        output = pathlib.Path(output)
        self.assertEqual(root, self.root)
        if operation == "export":
            (output / "bundle.l10n.json").write_text(
                '{"Open logs":{"message":"Open logs","comment":["Button"]}}',
                encoding="utf-8",
            )
        elif operation == "generate-xlf":
            output.write_bytes(b"<xliff>\r\n</xliff>\r\n")
        elif operation == "import-xlf":
            _, runtime = localization.metadata(root)
            for locale in localization.LOCALES:
                kinds = ("package.nls", "bundle.l10n") if runtime else ("package.nls",)
                for kind in kinds:
                    name = f"{kind}.{locale}.json"
                    content = json.dumps({"description": f"{locale} translation"})
                    if name == self.bad_json:
                        content = "{}"
                    (output / name).write_text(content, encoding="utf-8-sig")
        else:
            self.fail(f"Unexpected operation: {operation}, {inputs}")

    def test_generic_runtime_export(self):
        for name in ("debugpy", "mypy-type-checker", "vscode-python-envs"):
            with self.subTest(name=name):
                self.configure(name)
                output = self.base / name
                xlf = localization.export_english(self.root, output, ["src"])
                self.assertEqual(xlf.name, f"ms-python.{name}-new.xlf")
                self.assertEqual(xlf.read_bytes(), b"<xliff>\n</xliff>\n")

    def test_shared_source_paths(self):
        source = self.root / "external" / "shared" / "src"
        source.mkdir(parents=True)
        localization.export_english(
            self.root, self.output, ["src", "external/shared/src"]
        )
        self.assertEqual(
            self.calls.call_args_list[0].args[4:],
            (str(self.root / "src"), str(source)),
        )

    def test_manifest_only_export(self):
        self.configure("autopep8", runtime=None)
        xlf = localization.export_english(self.root, self.output, [])
        self.assertEqual(xlf.name, "ms-python.autopep8-new.xlf")
        self.assertEqual(self.calls.call_count, 1)
        self.assertEqual(self.calls.call_args.args[1], "generate-xlf")
        self.assertFalse((self.output / "bundle.l10n.json").exists())

    def test_missing_source_and_invalid_source_input(self):
        for paths in (["missing"], ["../outside"], [], [1]):
            with self.subTest(paths=paths):
                with self.assertRaises((ValueError, FileNotFoundError)):
                    localization.export_english(self.root, self.output, paths)
                self.assertFalse((self.output / "ms-python.tool-new.xlf").exists())
                if self.output.exists():
                    shutil.rmtree(self.output)

    def test_bad_metadata(self):
        for runtime in ("../outside", ".", "", 4):
            with self.subTest(runtime=runtime):
                self.configure(runtime=runtime)
                with self.assertRaises(ValueError):
                    localization.metadata(self.root)
        self.configure("../escape")
        with self.assertRaises(ValueError):
            localization.metadata(self.root)

    def test_cli_failure_is_propagated(self):
        self.calls.side_effect = subprocess.CalledProcessError(1, ["npx"])
        with self.assertRaises(subprocess.CalledProcessError):
            localization.export_english(self.root, self.output, ["src"])

    def test_missing_and_empty_export_bundle(self):
        for content in (None, "{}"):
            with self.subTest(content=content):

                def empty_export(_root, _operation, _flag, output, *_inputs):
                    if content is not None:
                        (pathlib.Path(output) / "bundle.l10n.json").write_text(content)

                self.calls.side_effect = empty_export
                with self.assertRaises((ValueError, FileNotFoundError)):
                    localization.export_english(self.root, self.output, ["src"])
                shutil.rmtree(self.output)

    def test_runtime_import_and_english_preservation(self):
        self.handbacks()
        english = (self.root / "package.nls.json").read_bytes()
        localization.import_translations(self.root, self.translations, self.output)
        self.assertEqual((self.root / "package.nls.json").read_bytes(), english)
        self.assertEqual(len(list(self.root.glob("package.nls.*.json"))), 14)
        self.assertEqual(len(list((self.root / "l10n").glob("*.json"))), 14)

    def test_manifest_only_import(self):
        self.configure("autopep8", runtime=None)
        self.handbacks(runtime=False)
        localization.import_translations(self.root, self.translations, self.output)
        self.assertEqual(len(list(self.root.glob("package.nls.*.json"))), 14)
        self.assertFalse((self.root / "l10n").exists())

    def test_readiness_checked_per_table(self):
        for kind in ("package", "bundle"):
            with self.subTest(kind=kind):
                self.handbacks(untranslated=("de", kind))
                existing = self.root / "package.nls.de.json"
                existing.write_text('{"description":"keep"}', encoding="utf-8")
                with self.assertRaisesRegex(ValueError, f"de/{kind} is wholly"):
                    localization.import_translations(
                        self.root, self.translations, self.output
                    )
                self.assertEqual(existing.read_text(), '{"description":"keep"}')
                self.assertFalse(self.output.exists())
                self.calls.assert_not_called()

    def test_partial_translation_is_allowed(self):
        files = self.handbacks()
        localization.validate_handback(files, runtime=True)

    def test_source_identical_marked_translated_is_allowed(self):
        for state in ("translated", "final", "signed-off"):
            with self.subTest(state=state):
                files = self.handbacks(same=True, state=state)
                localization.validate_handback(files, runtime=True)

    def test_all_new_english_is_rejected(self):
        files = self.handbacks(same=True)
        with self.assertRaisesRegex(ValueError, "wholly untranslated"):
            localization.validate_handback(files, runtime=True)

    def test_pseudo_localization_is_not_translation_evidence(self):
        files = self.handbacks(untranslated=("qps-ploc", "package"))
        localization.validate_handback(files, runtime=True)

    def test_missing_and_duplicate_locale_tables(self):
        files = self.handbacks()
        with self.assertRaisesRegex(ValueError, "missing zh-tw/package"):
            localization.validate_handback(files[:-1], runtime=True)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            localization.validate_handback([*files, files[0]], runtime=True)

    def test_missing_runtime_tables(self):
        files = self.handbacks(runtime=False)
        with self.assertRaisesRegex(ValueError, "missing cs/bundle"):
            localization.validate_handback(files, runtime=True)

    def test_missing_and_wrong_identity_handbacks(self):
        with self.assertRaisesRegex(FileNotFoundError, "No ms-python.tool handbacks"):
            localization.import_translations(self.root, self.translations, self.output)
        with self.assertRaisesRegex(FileNotFoundError, "unavailable"):
            localization.import_translations(
                self.root, self.base / "absent", self.output
            )

    def test_invalid_cli_output_copies_nothing(self):
        self.handbacks()
        self.bad_json = "bundle.l10n.zh-tw.json"
        existing = self.root / "package.nls.de.json"
        existing.write_text('{"description":"keep"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Invalid or empty"):
            localization.import_translations(self.root, self.translations, self.output)
        self.assertEqual(existing.read_text(), '{"description":"keep"}')
        self.assertFalse((self.root / "l10n").exists())

    def test_invalid_string_tables(self):
        table = self.base / "invalid.json"
        for value in ([], {}, {"key": 1}, {"key": ""}, {"key": {"message": "text"}}):
            with self.subTest(value=value):
                table.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(ValueError):
                    localization.read_table(table)

    def test_existing_staging_is_rejected(self):
        self.handbacks()
        self.output.mkdir()
        with self.assertRaises(FileExistsError):
            localization.import_translations(self.root, self.translations, self.output)
        self.calls.assert_not_called()

    def test_staging_cannot_be_a_generated_source_directory(self):
        self.handbacks()
        with self.assertRaisesRegex(ValueError, "outside extension source"):
            localization.import_translations(
                self.root, self.translations, self.root / "l10n"
            )
        self.assertFalse((self.root / "l10n").exists())
        self.calls.assert_not_called()

    def test_malformed_xml_and_empty_tables(self):
        files = self.handbacks()
        files[0].write_text("<not-closed")
        with self.assertRaises(ET.ParseError):
            localization.validate_handback(files, runtime=True)
        files = self.handbacks()
        document = ET.parse(files[0])
        body = document.find(".//{*}body")
        body.clear()
        document.write(files[0])
        with self.assertRaisesRegex(ValueError, "Empty translation table"):
            localization.validate_handback(files, runtime=True)

    def test_cli_pin_and_windows_resolution(self):
        self.cli.stop()
        with mock.patch.object(localization.shutil, "which", return_value="npx.cmd"):
            with mock.patch.object(localization.subprocess, "run") as run:
                localization.run_cli(self.root, "export", "-o", "output")
        run.assert_called_once_with(
            ["npx.cmd", "--yes", "@vscode/l10n-dev@0.0.35", "export", "-o", "output"],
            cwd=self.root,
            check=True,
        )

    def test_main_import_derives_canonical_directory(self):
        canonical = self.translations / "ms-python.tool"
        canonical.mkdir()
        with mock.patch.object(localization, "import_translations") as importer:
            localization.main(
                [
                    "--operation",
                    "import",
                    "--extension-root",
                    str(self.root),
                    "--output-directory",
                    str(self.output),
                    "--translations-root",
                    str(self.translations),
                ]
            )
        importer.assert_called_once_with(self.root, canonical, self.output)


class SubmissionTests(unittest.TestCase):
    """Exercise real dev-only commits, no-ops, and rejected push retries."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="localization git ")
        self.addCleanup(self.temporary.cleanup)
        self.base = pathlib.Path(self.temporary.name).resolve()
        self.remote = self.base / "drop.git"
        self.drop = self.base / "checkout"
        self.root = self.base / "extension"
        self.output = self.base / "english"
        self.root.mkdir()
        self.output.mkdir()
        (self.root / "package.json").write_text(
            '{"publisher":"ms-python","name":"tool"}', encoding="utf-8"
        )
        (self.output / "ms-python.tool-new.xlf").write_bytes(b"<xliff/>\n")
        subprocess.run(
            ["git", "init", "--bare", "--quiet", str(self.remote)], check=True
        )
        subprocess.run(
            ["git", "clone", "--quiet", str(self.remote), str(self.drop)],
            check=True,
            capture_output=True,
        )
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("checkout", "-b", "main")
        self.git("commit", "--allow-empty", "-m", "Initial")
        self.git("push", "origin", "main")
        self.main = self.git("rev-parse", "HEAD")
        self.git("checkout", "-b", "dev")
        self.git("push", "-u", "origin", "dev")

    def git(self, *args):
        return localization.git(self.drop, *args)

    def submit(self):
        localization.submit_english(self.root, self.output, self.drop, "dev")

    def test_push_then_noop_preserves_main(self):
        self.submit()
        submitted = self.git("rev-parse", "HEAD")
        self.assertNotEqual(submitted, self.main)
        self.assertEqual(self.git("rev-parse", "origin/main"), self.main)
        self.assertEqual(self.git("rev-parse", "origin/dev"), submitted)
        self.assertEqual(
            self.git("diff", "--name-only", self.main, submitted),
            "src/en/ms-python.tool/ms-python.tool-new.xlf",
        )
        self.submit()
        self.assertEqual(self.git("rev-parse", "HEAD"), submitted)

    def test_wrong_branch_is_rejected(self):
        self.git("checkout", "main")
        with self.assertRaisesRegex(ValueError, "must be on the dev branch"):
            self.submit()

    def test_missing_remote_branch_is_rejected(self):
        self.git("push", "origin", "--delete", "dev")
        with self.assertRaises(subprocess.CalledProcessError):
            self.submit()

    def test_dirty_drop_is_rejected(self):
        (self.drop / "unrelated").write_text("do not commit")
        with self.assertRaisesRegex(ValueError, "must be clean"):
            self.submit()

    def test_racing_push_rebases_and_retries(self):
        run = subprocess.run
        rejected = False

        def race(command, **kwargs):
            nonlocal rejected
            if command[:3] == ["git", "push", "origin"] and not rejected:
                rejected = True
                return subprocess.CompletedProcess(
                    command, 1, "", "! [rejected] HEAD -> dev (fetch first)"
                )
            return run(command, **kwargs)

        with mock.patch.object(localization.subprocess, "run", side_effect=race):
            self.submit()
        self.assertTrue(rejected)
        self.assertEqual(
            self.git("rev-parse", "origin/dev"), self.git("rev-parse", "HEAD")
        )


if __name__ == "__main__":
    unittest.main()
