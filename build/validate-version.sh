#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Validates that the git tag version matches all manifest files.
# Called by azure-pipelines-release.yml during the Validate stage.
#
# Expects BUILD_SOURCEBRANCH to be set (e.g. refs/tags/v0.2.0).
# Outputs: ReleaseVersion pipeline variable.

set -euo pipefail

TAG_VERSION="${BUILD_SOURCEBRANCH#refs/tags/v}"
FILE_VERSION=$(cat VERSION | tr -d '[:space:]')
PKG_VERSION=$(node -e "console.log(require('./typescript/package.json').version)")
PYPROJECT_VERSION=$(python3 -c "
import re
content = open('python/pyproject.toml').read()
m = re.search(r'^version\s*=\"([^\"]+)\"', content, re.MULTILINE)
print(m.group(1) if m else 'NOT_FOUND')
")

echo "Tag version:            $TAG_VERSION"
echo "VERSION file:           $FILE_VERSION"
echo "package.json version:   $PKG_VERSION"
echo "pyproject.toml version: $PYPROJECT_VERSION"

ERRORS=0
if [ "$TAG_VERSION" != "$FILE_VERSION" ]; then
  echo "##vso[task.logissue type=error]Tag ($TAG_VERSION) != VERSION file ($FILE_VERSION)"
  ERRORS=$((ERRORS + 1))
fi
if [ "$TAG_VERSION" != "$PKG_VERSION" ]; then
  echo "##vso[task.logissue type=error]Tag ($TAG_VERSION) != package.json ($PKG_VERSION)"
  ERRORS=$((ERRORS + 1))
fi
if [ "$TAG_VERSION" != "$PYPROJECT_VERSION" ]; then
  echo "##vso[task.logissue type=error]Tag ($TAG_VERSION) != pyproject.toml ($PYPROJECT_VERSION)"
  ERRORS=$((ERRORS + 1))
fi

if [ "$ERRORS" -gt 0 ]; then
  echo "##vso[task.logissue type=error]Version mismatch detected. Run 'python scripts/sync-version.py $TAG_VERSION' and push."
  exit 1
fi

echo "##vso[task.setvariable variable=ReleaseVersion;isOutput=true]$TAG_VERSION"
echo "✅ All versions consistent: $TAG_VERSION"
