#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Trigger on-demand Dependabot updates for downstream repositories.

Required environment variables:
- GH_TOKEN
- DOWNSTREAM_REPOS (newline-separated owner/repo values)

Optional environment variables:
- RELEASE_TAG (used to derive default target branch)
- DEPENDABOT_PACKAGE_ECOSYSTEMS (comma-separated, default: npm,pip)
- DEPENDABOT_DIRECTORY (default: /)
- DEPENDABOT_TARGET_BRANCH (default: shared-package-v<release version> when RELEASE_TAG is set, else main)
- DEPENDABOT_NPM_DEPENDENCY_NAME (default: @vscode/common-python-lsp)
- DEPENDABOT_PIP_DEPENDENCY_NAME (default: vscode-common-python-lsp)
"""

from __future__ import annotations

import json
import os
import sys

from ._actions_output import write_block_and_json_output
from ._env import (
    dependency_name_for_ecosystem,
    load_csv_env,
    load_repos,
    require_env,
    resolve_target_branch,
)
from ._github_cli import run_gh


def _trigger_update(
    repo: str,
    ecosystem: str,
    directory: str,
    target_branch: str,
    dependency_name: str | None,
) -> str:
    args = [
        "api",
        f"repos/{repo}/dependabot/updates",
        "-X",
        "POST",
        "-f",
        f"package-ecosystem={ecosystem}",
        "-f",
        f"directory={directory}",
        "-f",
        f"target-branch={target_branch}",
    ]
    if dependency_name:
        args.extend(["-f", f"dependency-name={dependency_name}"])

    output = run_gh(args)

    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return "requested"

    job_id = payload.get("id")
    return str(job_id) if job_id is not None else "requested"


def main() -> None:
    require_env("GH_TOKEN")
    repos = load_repos()
    ecosystems = load_csv_env("DEPENDABOT_PACKAGE_ECOSYSTEMS", "npm,pip")
    directory = os.getenv("DEPENDABOT_DIRECTORY", "/").strip() or "/"
    target_branch = resolve_target_branch(os.getenv("RELEASE_TAG", "").strip() or None)

    results: dict[str, dict[str, str]] = {}
    for repo in repos:
        results[repo] = {}
        for ecosystem in ecosystems:
            dependency_name = dependency_name_for_ecosystem(ecosystem)
            job_id = _trigger_update(
                repo,
                ecosystem,
                directory,
                target_branch,
                dependency_name,
            )
            results[repo][ecosystem] = job_id
            print(f"{repo}:{ecosystem}:{job_id}")

    lines = [
        f"{repo}:{ecosystem}:{job}"
        for repo, by_ecosystem in results.items()
        for ecosystem, job in by_ecosystem.items()
    ]
    write_block_and_json_output(
        "dependabot_update_jobs",
        "dependabot_update_job_map",
        lines,
        results,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
