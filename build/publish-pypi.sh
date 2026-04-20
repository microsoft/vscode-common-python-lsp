#!/usr/bin/env bash
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Uploads Python packages to an Azure DevOps PyPI feed via twine.
# Called by azure-pipelines-release.yml.
#
# Expects environment variables:
#   AZDO_TOKEN    - AAD token for feed authentication
#   PYPI_FEED_URL - PyPI upload URL
#   ARTIFACT_PATH - Path to directory containing dist files (*.whl, *.tar.gz)

set -euo pipefail

: "${AZDO_TOKEN:?AZDO_TOKEN is required}"
: "${PYPI_FEED_URL:?PYPI_FEED_URL is required}"
: "${ARTIFACT_PATH:?ARTIFACT_PATH is required}"

echo "Uploading to: $PYPI_FEED_URL"
echo "Artifacts in: $ARTIFACT_PATH"
ls -la "$ARTIFACT_PATH"/

twine upload \
    --repository-url "$PYPI_FEED_URL" \
    --username VssSessionToken \
    --password "$AZDO_TOKEN" \
    "$ARTIFACT_PATH"/*

echo "✅ twine upload succeeded"
