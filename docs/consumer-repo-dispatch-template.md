# Consumer Repo Workflow Template

Use this workflow in each consumer repository to handle `repository_dispatch` events sent by:
- [.github/workflows/downstream-release-dispatch.yml](../.github/workflows/downstream-release-dispatch.yml)

```yaml
name: Shared Package Release Handler

on:
  repository_dispatch:
    types: [shared-package-release]

permissions:
  contents: write
  pull-requests: write

jobs:
  update-shared-packages:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: "20"

      - uses: actions/setup-python@v6
        with:
          python-version: "3.x"

      - name: Create branch for this release
        env:
          RELEASE_TAG: ${{ github.event.client_payload.release_tag }}
        run: |
          set -euo pipefail
          BRANCH="shared-package-v${RELEASE_TAG#v}"
          git fetch origin main
          git checkout -B "$BRANCH" origin/main

      - name: Update npm dependency
        env:
          NPM_DEP: ${{ github.event.client_payload.npm_dependency }}
          RELEASE_TAG: ${{ github.event.client_payload.release_tag }}
        run: |
          set -euo pipefail
          npm install "$NPM_DEP@${RELEASE_TAG#v}"

      - name: Update pip dependency reference (example: requirements file)
        env:
          PIP_DEP: ${{ github.event.client_payload.pip_dependency }}
          RELEASE_TAG: ${{ github.event.client_payload.release_tag }}
        run: |
          set -euo pipefail
          python - <<'PY'
          from pathlib import Path
          import os
          import re

          dep = os.environ["PIP_DEP"]
          tag = os.environ["RELEASE_TAG"]
            version = tag[1:] if tag.startswith("v") else tag
            pinned = f"{dep}=={version}"
          req = Path("requirements.txt")
          if req.exists():
              txt = req.read_text(encoding="utf-8")
              updated = re.sub(rf"^{re.escape(dep)}([<>=!~].*)?$", pinned, txt, flags=re.MULTILINE)
              req.write_text(updated, encoding="utf-8")
          PY

      - name: Commit and open PR if changed
        env:
          RELEASE_TAG: ${{ github.event.client_payload.release_tag }}
          RELEASE_URL: ${{ github.event.client_payload.release_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail

          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

          if git diff --quiet; then
            echo "No changes detected."
            exit 0
          fi

          BRANCH="shared-package-v${RELEASE_TAG#v}"
          git add -A
          git commit -m "Upgrade shared package to ${RELEASE_TAG}"
          git push --set-upstream origin "$BRANCH"

          gh pr create \
            --base main \
            --head "$BRANCH" \
            --title "[Shared Package] Upgrade to ${RELEASE_TAG}" \
            --body "Automated update from ${RELEASE_URL}"
```

## Dispatch payload fields

The dispatcher sends these `client_payload` fields:
- `source_repo`
- `release_tag`
- `release_url`
- `release_name`
- `npm_dependency`
- `pip_dependency`

## Template notes

- This is a starter template. Each consumer repo should adjust file paths and update commands to match its actual layout.
- The `release_tag` is expected to be `v`-prefixed (for example, `v1.2.3`); npm/pip examples strip a single leading `v` when pinning the dependency version.
- The pip step must update tracked files (for example `requirements.txt`, `pyproject.toml`, or lock files), not just install locally.
