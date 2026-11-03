# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

"""Submit English localization inputs or import validated release handbacks."""

import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

CLI = "@vscode/l10n-dev@0.0.35"
LOCALES = (
    "cs",
    "de",
    "es",
    "fr",
    "it",
    "ja",
    "ko",
    "pl",
    "pt-br",
    "qps-ploc",
    "ru",
    "tr",
    "zh-cn",
    "zh-tw",
)
LOCALE_ALIASES = {"zh-hans": "zh-cn", "zh-hant": "zh-tw"}
TRANSLATED_STATES = {"translated", "final", "signed-off"}


def inside(root: pathlib.Path, value: str) -> pathlib.Path:
    """Resolve a non-root path without allowing escape from the extension."""
    path = (root / value).resolve()
    if path == root or not path.is_relative_to(root):
        raise ValueError(f"Expected a path inside the extension: {value}")
    return path


def metadata(root: pathlib.Path) -> tuple[str, pathlib.Path | None]:
    """Read the canonical extension ID and optional runtime output directory."""
    package = json.loads((root / "package.json").read_text(encoding="utf-8-sig"))
    identity = [package.get("publisher"), package.get("name")]
    if not all(
        isinstance(part, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", part)
        for part in identity
    ):
        raise ValueError("package.json must declare a valid publisher and name.")
    runtime = package.get("l10n")
    if runtime is not None and (not isinstance(runtime, str) or not runtime):
        raise ValueError("package.json l10n must be a nonempty relative directory.")
    return ".".join(identity), inside(root, runtime) if runtime is not None else None


def run_cli(root: pathlib.Path, *arguments: str) -> None:
    """Run the pinned localization CLI through the configured npm feed."""
    executable = shutil.which("npx")
    if executable is None:
        raise FileNotFoundError("npx is required to run the localization CLI.")
    subprocess.run([executable, "--yes", CLI, *arguments], cwd=root, check=True)


def read_table(path: pathlib.Path, *, comments: bool = False) -> dict:
    """Read a nonempty string table, optionally allowing export message metadata."""
    table = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(table, dict) or not table:
        raise ValueError(f"Invalid or empty localization table: {path}")
    for value in table.values():
        if comments and isinstance(value, dict):
            value = value.get("message")
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Invalid or empty localization string in {path}")
    return table


def create_staging(root: pathlib.Path, output: pathlib.Path) -> None:
    """Keep staging outside source until the complete import is validated."""
    if output.resolve().is_relative_to(root.resolve()):
        raise ValueError("Localization staging must be outside extension source.")
    output.mkdir(parents=True, exist_ok=False)


def export_english(
    root: pathlib.Path, output: pathlib.Path, source_paths: list[str]
) -> pathlib.Path:
    """Export manifest and declared runtime strings to a new staging directory."""
    extension_id, runtime = metadata(root)
    read_table(root / "package.nls.json")
    create_staging(root, output)
    inputs = []
    if runtime is not None:
        if not source_paths or not all(isinstance(p, str) for p in source_paths):
            raise ValueError("Runtime export requires a nonempty list of source paths.")
        sources = [inside(root, path) for path in source_paths]
        for source in sources:
            if not source.is_dir():
                raise FileNotFoundError(
                    f"Missing extraction source: {source}. "
                    "Initialize required submodules."
                )
        run_cli(root, "export", "-o", str(output), *(str(p) for p in sources))
        bundle = output / "bundle.l10n.json"
        read_table(bundle, comments=True)
        inputs.append(str(bundle))
    xlf = output / f"{extension_id}-new.xlf"
    run_cli(root, "generate-xlf", "-o", str(xlf), *inputs, "package.nls.json")
    content = xlf.read_text(encoding="utf-8-sig")
    with xlf.open("w", encoding="utf-8", newline="\n") as destination:
        destination.write(content)
    return xlf


def validate_handback(files: list[pathlib.Path], runtime: bool) -> None:
    """Require coverage and translation evidence in each required locale table."""
    kinds = ("package", "bundle") if runtime else ("package",)
    tables = {}
    for path in files:
        document = ET.parse(path)
        for table in document.findall(".//{*}file"):
            locale = table.get("target-language", "").lower()
            locale = LOCALE_ALIASES.get(locale, locale)
            kind = table.get("original")
            if locale not in LOCALES or kind not in kinds:
                continue
            key = (locale, kind)
            if key in tables:
                raise ValueError(f"Duplicate translation table: {locale}/{kind}")
            units = table.findall(".//{*}trans-unit")
            if not units:
                raise ValueError(f"Empty translation table: {locale}/{kind}")
            translated = False
            for unit in units:
                source = unit.find("{*}source")
                target = unit.find("{*}target")
                if source is None or not "".join(source.itertext()).strip():
                    raise ValueError(f"Missing English source in {locale}/{kind}")
                if target is not None:
                    text = "".join(target.itertext()).strip()
                    translated |= bool(text) and (
                        text != "".join(source.itertext()).strip()
                        or target.get("state") in TRANSLATED_STATES
                    )
            tables[key] = translated
    for locale in LOCALES:
        for kind in kinds:
            if (locale, kind) not in tables:
                raise ValueError(
                    f"Incomplete translation handback: missing {locale}/{kind}"
                )
            if locale != "qps-ploc" and not tables[locale, kind]:
                raise ValueError(
                    f"Translation handback is not ready: {locale}/{kind} is wholly "
                    "untranslated. Wait for translated output from the "
                    "localization service."
                )


def import_translations(
    root: pathlib.Path, translations: pathlib.Path, output: pathlib.Path
) -> None:
    """Validate all handbacks in staging before placing any generated locale files."""
    extension_id, runtime = metadata(root)
    if not translations.is_dir():
        raise FileNotFoundError(
            f"Translated output is unavailable: {translations}. "
            "Submit English strings and wait for localization-service handbacks."
        )
    files = sorted(translations.rglob(f"{extension_id}-new.xlf"))
    if not files:
        raise FileNotFoundError(f"No {extension_id} handbacks found in {translations}")
    validate_handback(files, runtime is not None)
    create_staging(root, output)
    run_cli(root, "import-xlf", "-o", str(output), *(str(file) for file in files))
    names = [f"package.nls.{locale}.json" for locale in LOCALES]
    if runtime is not None:
        names.extend(f"bundle.l10n.{locale}.json" for locale in LOCALES)
    for name in names:
        read_table(output / name)
    if runtime is not None:
        runtime.mkdir(parents=True, exist_ok=True)
    for name in names:
        destination = root if name.startswith("package.nls.") else runtime
        shutil.copyfile(output / name, destination / name)


def git(root: pathlib.Path, *arguments: str) -> str:
    """Run a Git command without shell interpolation."""
    result = subprocess.run(
        ["git", *arguments], cwd=root, check=False, capture_output=True, text=True
    )
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        result.check_returncode()
    return result.stdout.strip()


def submit_english(
    root: pathlib.Path, output: pathlib.Path, drop: pathlib.Path, branch: str
) -> None:
    """Commit only this extension's changed English XLF on the configured branch."""
    extension_id, _ = metadata(root)
    git(drop, "check-ref-format", "--branch", branch)
    if git(drop, "branch", "--show-current") != branch:
        raise ValueError(f"Localization checkout must be on the {branch} branch.")
    if git(drop, "status", "--porcelain"):
        raise ValueError("Localization checkout must be clean before submission.")
    git(drop, "pull", "--rebase", "origin", branch)
    git(drop, "config", "user.name", "github-actions[bot]")
    git(
        drop,
        "config",
        "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com",
    )
    git(drop, "config", "core.autocrlf", "input")
    source = output / f"{extension_id}-new.xlf"
    destination = drop / "src" / "en" / extension_id / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    relative = str(destination.relative_to(drop))
    git(drop, "add", "--", relative)
    if not git(drop, "diff", "--cached", "--name-only", "--", relative):
        print("English localization strings are already up to date.")
        return
    git(drop, "commit", "-m", f"Update English strings for {extension_id}")
    for attempt in range(3):
        git(drop, "pull", "--rebase", "origin", branch)
        pushed = subprocess.run(
            ["git", "push", "origin", f"HEAD:refs/heads/{branch}"],
            cwd=drop,
            capture_output=True,
            text=True,
            check=False,
        )
        if pushed.returncode == 0:
            print(f"Submitted English strings for {extension_id} to {branch}.")
            return
        if attempt == 2 or not (
            "[rejected]" in pushed.stderr
            and ("fetch first" in pushed.stderr or "non-fast-forward" in pushed.stderr)
        ):
            print(pushed.stderr, file=sys.stderr)
            pushed.check_returncode()
        print("Localization branch advanced; rebasing before retrying submission.")


def main(argv=None) -> None:
    """Run the same explicit Python interface from GitHub Actions and Azure."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--operation", choices=("export", "import", "submit"), required=True
    )
    parser.add_argument(
        "--extension-root", type=pathlib.Path, default=pathlib.Path.cwd()
    )
    parser.add_argument("--output-directory", type=pathlib.Path, required=True)
    parser.add_argument("--source-paths", default='["src"]')
    parser.add_argument("--translations-root", type=pathlib.Path)
    parser.add_argument("--drop-root", type=pathlib.Path)
    parser.add_argument("--branch", default="dev")
    args = parser.parse_args(argv)
    root = args.extension_root.resolve()
    output = args.output_directory.resolve()
    if args.operation == "export":
        paths = json.loads(args.source_paths)
        if not isinstance(paths, list):
            raise ValueError("--source-paths must be a JSON array.")
        export_english(root, output, paths)
    elif args.operation == "import":
        if args.translations_root is None:
            parser.error("--translations-root is required for import")
        extension_id, _ = metadata(root)
        import_translations(root, args.translations_root / extension_id, output)
    else:
        if args.drop_root is None:
            parser.error("--drop-root is required for submission")
        submit_english(root, output, args.drop_root.resolve(), args.branch)


if __name__ == "__main__":
    main()
