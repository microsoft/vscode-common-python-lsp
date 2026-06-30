#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Create downstream release branches for a published release.

Required environment variables:
- GH_TOKEN
- RELEASE_TAG
- RELEASE_URL
- DOWNSTREAM_REPOS (newline-separated owner/repo values)

"""

from __future__ import annotations

import json
import sys

from ._actions_output import write_block_and_json_output
from ._env import load_repos, require_env
from ._github_cli import run_gh


def _load_branch_name(release_tag: str) -> str:
    version = release_tag.removeprefix("v")
    return f"shared-package-v{version}"


def _branch_exists(repo: str, branch: str) -> bool:
    try:
        run_gh(["api", f"repos/{repo}/git/ref/heads/{branch}"])
        return True
    except RuntimeError:
        return False


def _create_branch(repo: str, branch: str) -> None:
    main_ref = json.loads(run_gh(["api", f"repos/{repo}/git/ref/heads/main"]))
    base_sha = main_ref["object"]["sha"]
    run_gh(
        [
            "api",
            f"repos/{repo}/git/refs",
            "-X",
            "POST",
            "-f",
            f"ref=refs/heads/{branch}",
            "-f",
            f"sha={base_sha}",
        ],
    )


def main() -> None:
    require_env("GH_TOKEN")
    release_tag = require_env("RELEASE_TAG")
    require_env("RELEASE_URL")
    repos = load_repos()

    branch = _load_branch_name(release_tag)
    created: dict[str, str] = {}
    for repo in repos:
        if _branch_exists(repo, branch):
            created[repo] = branch
            print(f"{repo}:{branch} (already exists)")
            continue

        _create_branch(repo, branch)
        created[repo] = branch
        print(f"{repo}:{branch}")

    write_block_and_json_output(
        "created_branches",
        "created_branch_map",
        [f"{repo}:{branch_name}" for repo, branch_name in created.items()],
        created,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
