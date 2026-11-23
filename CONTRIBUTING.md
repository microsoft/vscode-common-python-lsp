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

Use the [supported architecture and adoption guide](docs/supported-apis.md) when
choosing extension-owned policy, shared public APIs or private implementation
boundaries. Recommended facade adoption does not deprecate manual composition.

### Python compatibility coverage

Both PR and push CI run `nox -s tests` on stable Python 3.10-3.15 on Ubuntu and
Windows. Each session installs `./python[dev]` into a fresh environment and logs
the resolved dependency versions with `pip list --format=freeze`. This tests
the resolver-selected, mutually compatible runtime and development dependencies
available for that interpreter at run time, not a locked or minimum-version
combination. Runtime requirements are `pygls>=1.1.0`,
`lsprotocol>=2023.0.0` and `packaging>=22.0`; transitive requirements also
participate in resolution.

The suite includes a real subprocess worker using shared `JsonRpc`,
`run_message_loop` and `run_module`, with tool output, exception recovery and
process cleanup checks. It does not depend on Pylint or another external tool.
The target-install smoke builds a clean staged copy using
`pip install --target ... --no-deps --no-cache-dir --no-build-isolation --upgrade`.
The development extra supplies the build backend (`setuptools` and `wheel`);
the nox environment supplies runtime dependencies. An isolated (`python -I`)
subprocess verifies package and distribution metadata originate in the target
and executes the installed runner. Staging keeps build artifacts out of the
source package. `--no-build-isolation` avoids downloading build tools in this
smoke; consumers may retain pip's normal isolated-build behavior.

These runs do not establish compatibility with every minimum dependency
combination, consumers' reviewed dependency locks/bundles, or consumer-provided
optional `debugpy`. Those require separate consumer validation. In particular,
shared-runtime coverage does not diagnose or fix downstream Pylint failures.
Older local Python 3.15 alphas are not stable-3.15 evidence, and CI does not pin
pytest to accommodate such alphas. Source-only, pinned-submodule consumption
and the consumer-owned dependency policy remain unchanged.

The dedicated `Check Python Versions` workflow invokes the SHA-pinned
`microsoft/vscode-python-ci/actions/check-python-versions` action for both
matrices. It runs on relevant PR workflow changes, weekly on Mondays at 12:00
UTC, and on manual dispatch. The action compares declared versions with the
newest Python 3 series that has a published release candidate; it does not run
tests or establish stable-interpreter support itself. This rollout uses
read-only, check-only mode: missing coverage is reported in the job summary,
not treated as a failing check, and no issues are created. Upstream issue mode
does not yet deduplicate issues. Release lookup or action/configuration errors
still fail the job.

### Settings boundary tests

The JSON corpus in `python/tests/fixtures/settings/` characterizes the existing
initialization-options contract. Fixture metadata is separate from
`initializationOptions`; `__ROOT_URI__`, `__ROOT_FS__`, `__CWD_FS__`, `__PYTHON__`
and `__SEP__` are test-only substitutions, not supported settings variables.
Python and TypeScript tests independently consume `producer.json`, including
host-resolved CWD variables that Python finishes resolving per document and an
opt-in enablement payload retaining mixed and nested roots.

`python/tests/test_server_stdio.py` starts a test-only ToolServer over real LSP
stdio and checks initialize/initialized/settings/shutdown/exit plus a test-only
formatting handler that consults the participation API. It needs no tool
installation, VS Code host or Node build. Repeated settings application is
covered separately in-process, not by reinitializing a live LSP session.

`ToolServer` remains the public settings facade and owns the writable global and
workspace dictionaries. Private `_settings` helpers construct fresh, shallow
settings dictionaries while retaining nested value aliases. Private `_routing`
helpers consult the facade on each call for in-place updates and workspace/document
selection, preserving path normalization and the distinct lookup fallbacks.
Neither private module caches settings or owns persistent state.

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
revision. See [building from a pinned submodule](README.md#building-from-a-pinned-submodule)
for the build and packaging contract. Consumer pipeline enforcement and
compatibility testing remain extension-owned.

## Reporting Issues

Please use [GitHub Issues](https://github.com/microsoft/vscode-common-python-lsp/issues) to report
bugs or suggest features. Before creating a new issue, please search existing issues to avoid
duplicates.
