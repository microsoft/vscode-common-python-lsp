#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Environment parsing helpers for downstream automation scripts."""

from __future__ import annotations

import os
import re

_REPO_PATTERN = re.compile(r"^[^/]+/[^/]+$")


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required.")
    return value


def load_repos(env_name: str = "DOWNSTREAM_REPOS") -> list[str]:
    raw_repos = require_env(env_name)
    repos = [line.strip() for line in raw_repos.splitlines() if line.strip()]
    if not repos:
        raise ValueError(f"{env_name} is empty.")

    invalid = [repo for repo in repos if not _REPO_PATTERN.match(repo)]
    if invalid:
        raise ValueError(f"Invalid repository value(s): {', '.join(invalid)}")
    return repos


def resolve_target_branch(release_tag: str | None = None) -> str:
    explicit = os.getenv("DEPENDABOT_TARGET_BRANCH", "").strip()
    if explicit:
        return explicit

    if release_tag:
        return f"shared-package-v{release_tag.removeprefix('v')}"
    return "main"


def load_csv_env(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    values = [entry.strip() for entry in raw.split(",") if entry.strip()]
    if not values:
        raise ValueError(f"{name} is empty.")
    return values


def dependency_name_for_ecosystem(ecosystem: str) -> str | None:
    if ecosystem == "npm":
        return os.getenv("DEPENDABOT_NPM_DEPENDENCY_NAME", "@vscode/common-python-lsp").strip() or None
    if ecosystem == "pip":
        return os.getenv("DEPENDABOT_PIP_DEPENDENCY_NAME", "vscode-common-python-lsp").strip() or None
    return None
