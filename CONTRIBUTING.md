# Contributing to vscode-common-python-lsp

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## How to Contribute

1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they pass the existing tests and linting.
3. Submit a pull request with a clear description of the changes.

## Adoption and milestones

Extensions consume this repository at a pinned Git commit and build both the
TypeScript and Python runtimes from that revision. The pinned source revision,
not the version strings in the package manifests, is the compatibility identity.

The private npm manifest and Python package metadata retain fixed version values
needed for local builds and installation. Ordinary source changes do not require
changing or synchronizing those values. The default Python server reports its
installed package version for diagnostics, but that value is not a source
provenance guarantee. The npm and Python packages are not published.

Maintainers may optionally tag a reviewed commit and create a
[GitHub Release](https://github.com/microsoft/vscode-common-python-lsp/releases)
with release notes as a human-readable milestone. A milestone does not require
package-version changes or publication and does not trigger or gate consumer
submodule updates.

Consumers are responsible for building both runtimes from their intended pinned
revision. Automated artifact-provenance enforcement and reliable build
invalidation remain roadmap S4 follow-up work rather than a package-version
release requirement.

## Reporting Issues

Please use [GitHub Issues](https://github.com/microsoft/vscode-common-python-lsp/issues) to report
bugs or suggest features. Before creating a new issue, please search existing issues to avoid
duplicates.
