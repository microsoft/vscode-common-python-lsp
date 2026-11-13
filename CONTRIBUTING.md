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

### Settings boundary tests

The JSON corpus in `python/tests/fixtures/settings/` characterizes the existing
initialization-options contract. Fixture metadata is separate from
`initializationOptions`; `__ROOT_URI__`, `__ROOT_FS__`, `__CWD_FS__`, `__PYTHON__`
and `__SEP__` are test-only substitutions, not supported settings variables.
Python and TypeScript tests independently consume `producer.json`, including
host-resolved CWD variables that Python finishes resolving per document.

`python/tests/test_server_stdio.py` starts a test-only ToolServer over real LSP
stdio and checks initialize/initialized/settings/shutdown/exit. It needs no tool
installation, VS Code host or Node build. Repeated settings application is
covered separately in-process, not by reinitializing a live LSP session.

## Adoption and milestones

Extensions consume this repository at a pinned Git commit and build both the
TypeScript and Python runtimes from that revision. The pinned source revision,
not the version strings in the package manifests, is the compatibility identity.

The private npm manifest and Python distribution metadata use the internal
build identity `vscode-python-tool-internal` and retain fixed version
values needed for local builds and installation. This identity is not a consumer
import API. Ordinary source changes do not require changing or synchronizing
those values. The default Python server reports that internal distribution's
installed version for diagnostics (or `v0.0.0-dev` when its metadata is absent),
but that value is not a source provenance guarantee. Neither runtime is
published to a package registry.

Record consumer-visible changes and upgrade instructions in pull request
descriptions. For breaking changes, add focused migration documentation.
There is no separate changelog to maintain; historical entries remain in Git
history.

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
