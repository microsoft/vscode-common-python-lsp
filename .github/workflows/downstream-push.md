---
on:
  push:
    branches: [main]
permissions:
      contents: read
engine: claude
network:
  allowed:
    - defaults
    - python
    - node
    - go
    - java
---

# downstream-push

## Downstream consumers
The packages exposed by this repo are consumed primarily by these first-party repos:
- https://github.com/microsoft/vscode-isort
- https://github.com/microsoft/vscode-flake8
- https://github.com/microsoft/vscode-mypy
- https://github.com/microsoft/vscode-pylint
- https://github.com/microsoft/vscode-black-formatter

## Release
On release, the consumer repos need to be notified of the change. When a new release is created, follow these steps for each of the repos:
1. Create a new issue titled "[Shared Package] Upgrade to newest release" with body "A new release for the shared packages [vscode-common-python-lsp](https://github.com/microsoft/vscode-common-python-lsp) is available. This new release includes new features and/or bug fixes." and keep the issue number
2. Create a new branch called "shared-package-v<VERSION>"
3. In that branch, update the versions of the shared packages in the 