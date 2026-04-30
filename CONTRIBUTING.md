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

## Versioning

This project adheres to [Semantic Versioning (SemVer)](https://semver.org/).
In short:

- **MAJOR** (`X.0.0`) – incompatible API changes.
- **MINOR** (`0.X.0`) – new functionality that is backwards-compatible.
- **PATCH** (`0.0.X`) – backwards-compatible bug fixes.

We cut a new **patch release every week** if there are any unreleased fixes on
`main`. If no fixes have landed since the last release, the weekly release is
skipped. All released versions are listed on the
[GitHub Releases](https://github.com/microsoft/vscode-common-python-lsp/releases) page.

Both the TypeScript and Python packages share a single version number defined in
the `VERSION` file at the repository root. When bumping the version:

```bash
# Set the version and propagate to package.json + pyproject.toml
python -m scripts.version.sync 0.2.0
```

To verify all manifests are in sync (also runs automatically in CI):

```bash
python -m scripts.version.validate
```

A PR will fail the **Version Check** workflow if the version in `VERSION`,
`typescript/package.json`, or `python/pyproject.toml` don't match.

### Automated weekly patch bump

A GitHub Actions workflow (`.github/workflows/auto-patch-bump.yml`) runs every
Monday at 00:00 UTC. If there are unreleased commits on `main` since the last
GitHub Release, the workflow automatically opens a PR that increments the patch
version and syncs all manifests. If a previous bump PR is still open and `main`
has advanced beyond it (new commits landed since the PR was created), the stale
PR is closed and replaced with a fresh one. If the existing PR still covers the
current state of `main`, no action is taken. Maintainers review and merge the
bump PR to trigger the release.

### Release process

1. Bump the version: `python -m scripts.version.sync X.Y.Z`
2. Update `CHANGELOG.md` with the new version and release notes.
3. Commit, push, and merge the PR.
4. Create a **GitHub Release** targeting `main` with tag `vX.Y.Z`.
5. Azure Pipelines automatically publishes both packages to the ADO feed.

## Reporting Issues

Please use [GitHub Issues](https://github.com/microsoft/vscode-common-python-lsp/issues) to report
bugs or suggest features. Before creating a new issue, please search existing issues to avoid
duplicates.
