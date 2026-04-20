# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
#
# Creates .npmrc files for Azure DevOps feed authentication and publishes
# the npm package. Called by azure-pipelines-release.yml.
#
# Expects environment variables:
#   AZDO_TOKEN        - AAD token for feed authentication
#   NPM_FEED_URL      - Full npm registry URL (https://...)
#   NPM_FEED_URL_NO_PROTOCOL - Registry URL without protocol (pkgs.dev.azure.com/...)
#   ARTIFACT_PATH      - Path to directory containing the .tgz artifact

param(
    [Parameter(Mandatory)]
    [string]$AzdoToken,

    [Parameter(Mandatory)]
    [string]$NpmFeedUrl,

    [Parameter(Mandatory)]
    [string]$NpmFeedUrlNoProtocol,

    [Parameter(Mandatory)]
    [string]$ArtifactPath
)

$ErrorActionPreference = 'Stop'

# Project-level .npmrc sets the default registry
@"
registry=$NpmFeedUrl
always-auth=true
"@ | Out-File -FilePath .npmrc
Write-Host "Created .npmrc (registry=$NpmFeedUrl)"

# User-level .npmrc holds the auth token
@"
; begin auth token
//${NpmFeedUrlNoProtocol}:username=VssSessionToken
//${NpmFeedUrlNoProtocol}:_authToken=$AzdoToken
//${NpmFeedUrlNoProtocol}:email=not-used@example.com
; end auth token
"@ | Out-File -FilePath $HOME/.npmrc
Write-Host "Created ~/.npmrc (auth configured)"

# Find and publish the tarball
$tgz = Get-ChildItem "$ArtifactPath/*.tgz" | Select-Object -First 1
if (-not $tgz) {
    Write-Error "No .tgz file found in $ArtifactPath"
    exit 1
}

Write-Host "Publishing: $($tgz.FullName)"
npm publish $tgz.FullName --registry $NpmFeedUrl
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "✅ npm publish succeeded"
