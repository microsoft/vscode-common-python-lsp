# Downstream Automation Scripts

This folder contains helper scripts used by the downstream release workflow.

Workflow entry point:
- [.github/workflows/upstream-release-sync.yml](../../.github/workflows/upstream-release-sync.yml)

## Why this exists

When a new release is published, multiple downstream extension repositories need coordinated follow-up:
- trigger dependency update jobs (Dependabot)
- create tracking issues with useful links
- optionally create release-specific branches

Putting this logic in Python scripts (instead of large inline shell blocks in YAML) makes it:
- easier to maintain
- easier to validate and test
- easier to reuse across workflow steps
- less error-prone for parsing/output handling

## High-level flow

Current workflow sequence is:
1. Trigger Dependabot updates in downstream repos (npm + pip, scoped dependency names).
2. Create one issue per downstream repo with:
   - release link
   - link to filtered Dependabot PRs

The workflow consumes script outputs through GitHub Actions `GITHUB_OUTPUT`.

## Files and responsibilities

### Public entry scripts

- [create_release_issues.py](create_release_issues.py)
  - Creates release-tracking issues in each downstream repo.
  - Builds issue body with release URL and Dependabot PR search URL.
  - Exports:
    - `created_issue_numbers`
    - `created_issue_map`

- [create_release_prs.py](create_release_prs.py)
  - Creates release branch `shared-package-v<version>` in each downstream repo.
  - Note: despite the file name, it currently creates branches (not pull requests).
  - Exports:
    - `created_branches`
    - `created_branch_map`

- [trigger_dependabot_updates.py](trigger_dependabot_updates.py)
  - Triggers on-demand Dependabot update jobs per downstream repo.
  - Requests ecosystems (default `npm,pip`) and targets specific dependency names:
    - npm: `@vscode/common-python-lsp`
    - pip: `vscode-common-python-lsp`
  - Exports:
    - `dependabot_update_jobs`
    - `dependabot_update_job_map`

### Shared helper modules

- [_env.py](_env.py)
  - Shared env var validation and parsing.
  - Repo list validation.
  - Target-branch resolution.
  - Ecosystem/dependency-name helpers.

- [_github_cli.py](_github_cli.py)
  - Wrapper for `gh` command execution.
  - Standardized error propagation with command context.
  - Utility to parse numeric IDs from URLs.

- [_actions_output.py](_actions_output.py)
  - Shared utility for writing multiline and JSON outputs to `GITHUB_OUTPUT`.

- [__init__.py](__init__.py)
  - Package marker for module execution (`python -m scripts.downstream.<script>`).

## Required environment variables

Most scripts require:
- `GH_TOKEN`
- `DOWNSTREAM_REPOS` (newline-separated `owner/repo` values)

Additional values depend on script purpose:
- `RELEASE_TAG`
- `RELEASE_URL`
- Dependabot tuning vars such as:
  - `DEPENDABOT_PACKAGE_ECOSYSTEMS`
  - `DEPENDABOT_DIRECTORY`
  - `DEPENDABOT_TARGET_BRANCH`
  - `DEPENDABOT_NPM_DEPENDENCY_NAME`
  - `DEPENDABOT_PIP_DEPENDENCY_NAME`

See each script docstring for exact inputs.

## Notes for maintainers

- Keep workflow orchestration in YAML and business logic in scripts.
- Prefer adding shared logic to helper modules instead of duplicating across scripts.
- If `create_release_prs.py` remains branch-only long term, consider renaming it to `create_release_branches.py` for clarity.
