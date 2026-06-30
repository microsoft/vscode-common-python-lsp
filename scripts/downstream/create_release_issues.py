#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Create downstream issues for a published release.

Required environment variables:
- GH_TOKEN
- RELEASE_TAG
- RELEASE_URL
- DOWNSTREAM_REPOS (newline-separated owner/repo values)
"""

from __future__ import annotations

import sys
from urllib.parse import urlencode

from ._actions_output import write_block_and_json_output
from ._env import load_repos, require_env, resolve_target_branch
from ._github_cli import parse_trailing_number, run_gh

ISSUE_TITLE = "[Shared Package] Upgrade to newest release"


def _create_issue(repo: str, body: str) -> int:
    output = run_gh(
        [
            "issue",
            "create",
            "--repo",
            repo,
            "--title",
            ISSUE_TITLE,
            "--body",
            body,
        ]
    )

    # gh issue create returns the URL of the created issue.
    issue_url = output.splitlines()[-1].strip()
    return parse_trailing_number(issue_url, r"/issues/(\d+)$", "issue")


def _build_issue_body(repo: str, release_tag: str, release_url: str) -> str:
    target_branch = resolve_target_branch(release_tag)
    query = urlencode({"q": f"is:pr is:open author:app/dependabot base:{target_branch}"})
    pr_link = f"https://github.com/{repo}/pulls?{query}"

    return (
        "A new release for the shared packages "
        "vscode-common-python-lsp is available: "
        f"[{release_tag}]({release_url}). "
        "This new release includes new features and/or bug fixes.\n\n"
        f"Dependabot PRs: [View open Dependabot PRs for {target_branch}]({pr_link})"
    )


def main() -> None:
    require_env("GH_TOKEN")
    release_tag = require_env("RELEASE_TAG")
    release_url = require_env("RELEASE_URL")
    repos = load_repos()

    created: dict[str, int] = {}
    for repo in repos:
        body = _build_issue_body(repo, release_tag, release_url)
        issue_number = _create_issue(repo, body)
        created[repo] = issue_number
        print(f"{repo}#{issue_number}")

    write_block_and_json_output(
        "created_issue_numbers",
        "created_issue_map",
        [f"{repo}#{number}" for repo, number in created.items()],
        created,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # pragma: no cover
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
