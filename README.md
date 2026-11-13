# vscode-common-python-lsp

Shared Python and TypeScript libraries for VS Code Python tool extensions
([black-formatter](https://github.com/microsoft/vscode-black-formatter),
[flake8](https://github.com/microsoft/vscode-flake8),
[isort](https://github.com/microsoft/vscode-isort),
[mypy](https://github.com/microsoft/vscode-mypy),
[pylint](https://github.com/microsoft/vscode-pylint)).

## Structure

```
vscode-common-python-lsp/
├── python/                         # Python source (bundled server-side)
│   ├── vscode_common_python_lsp/   # Import package source
│   │   └── __init__.py
│   ├── tests/                      # Python tests (pytest)
│   ├── pyproject.toml              # Local installation metadata & build config
│   └── requirements-dev.txt        # Dev/test dependencies
│
├── typescript/                     # TypeScript source (VS Code client-side)
│   ├── src/                        # Public entry point and implementation
│   │   └── index.ts
│   ├── tests/                      # TypeScript tests (mocha)
│   ├── package.json
│   └── tsconfig.json
│
├── .github/                        # CI/CD workflows
├── LICENSE
├── SECURITY.md
└── README.md
```

## Python Source

The `vscode_common_python_lsp` Python package provides server-side utilities shared
across all five extensions: path resolution, context managers, tool execution runners,
JSON-RPC process management, and the LSP server factory.

### Development

```bash
cd python
pip install -e ".[dev]"
pytest tests/
```

## TypeScript Source

The TypeScript source provides VS Code client-side
utilities: extension activation, server lifecycle, settings management, Python
interpreter resolution, and logging.

### Development

```bash
cd typescript
npm ci
npm run lint
npm run build
npm test
```

Linting uses ESLint 10 with the flat configuration in `typescript/eslint.config.mjs`.
Use the Node.js version pinned in `.nvmrc` for development.

## Consuming in Extensions

### Shared runtime libraries

Consume this repository as a git submodule so the Python and TypeScript
libraries are pinned to the same commit. The VS Code Python tool extensions
place the checkout under `external/`:

```bash
git submodule add https://github.com/microsoft/vscode-common-python-lsp.git external/vscode-common-python-lsp
git submodule update --init --recursive
```

Clone a consuming extension with `--recurse-submodules`, or run the update
command above after cloning.

#### TypeScript: build, type-check, then bundle

The extension does not declare a shared-runtime npm dependency or alias. From
the extension root, install its own locked development tools and the checkout's
locked dependencies, then build the shared JavaScript and declarations **before**
type-checking or bundling the extension:

```powershell
npm ci
npm --prefix .\external\vscode-common-python-lsp\typescript ci
npm --prefix .\external\vscode-common-python-lsp\typescript run build
```

In the extension's `src/extension.ts`, import exported symbols from the built
public entry point (not individual implementation files or a bare package name):

```typescript
import { createToolContext } from '../external/vscode-common-python-lsp/typescript/dist';
```

Use the extension's existing TypeScript configuration and development type
dependencies, including `@types/vscode` and `@types/node`, to type-check its
`src/` files. The shared declarations resolve their dependencies from the
checkout's `typescript/node_modules`; the extension's `rootDir` can remain
`src`. For example, with TypeScript already installed by the extension:

```powershell
npx --no-install tsc --noEmit
```

Bundle the source-relative entry and its JavaScript dependency closure into the
extension. For example, an extension already using esbuild can run this from
the extension root after the steps above:

```powershell
npx --no-install esbuild .\src\extension.ts --bundle --platform=node --format=cjs --external:vscode --outfile=.\dist\extension.js
```

VS Code supplies `vscode`, and esbuild leaves Node built-ins external. Do not
externalize the shared entry or its npm dependencies: they must resolve from
the checkout and be included in the bundle. Merely running `tsc` does not bundle
them; shipping only the extension's emitted JavaScript would leave a relative
runtime dependency on the checkout. Other bundlers must preserve the same
resolution and packaging behavior. Rebuild both the shared entry and extension
bundle whenever the pinned checkout changes.

When migrating an existing consumer, remove its former shared-runtime
dependency/alias, update its imports and regenerate its lockfile without that
dependency. Review the consumer's own build and packaging rules; changing this
repository's metadata alone does not migrate an extension.

#### Python: install from the same checkout

Install the Python source directly from the same submodule commit when building
the extension bundle. For example, in `noxfile.py`:

```python
import pathlib

import nox


@nox.session(python="3.10")
def install_bundled_libs(session: nox.Session) -> None:
    shared_python_lib = pathlib.Path("external/vscode-common-python-lsp/python")
    if not shared_python_lib.exists():
        session.error(
            f"Shared package submodule missing at {shared_python_lib}. "
            "Run 'git submodule update --init --recursive' before building."
        )

    session.install(
        "-t",
        "./bundled/libs",
        "--no-cache-dir",
        "--no-deps",
        "--upgrade",
        str(shared_python_lib),
    )
```

The `--no-deps` example preserves the consumer's runtime dependency policy: the
extension must also bundle the dependencies declared in `python/pyproject.toml`
using its own reviewed requirements/locks. Keep the installed distribution
metadata alongside `vscode_common_python_lsp`; the default server uses its
version for diagnostics, or `v0.0.0-dev` if that metadata is absent. Python
imports continue to use `vscode_common_python_lsp`.

Both manifests use `vscode-python-tool-internal` solely as internal
local build/install metadata. npm remains private, and Python metadata is marked
`Private :: Do Not Upload`. Local-path pip installation and local wheel builds
remain supported. Neither identity is a registry-facing consumption API: do not
add a bare dependency or registry install for it. This repository publishes
neither npm nor PyPI packages.

### Dependabot updates

The consuming extensions configure Dependabot's `gitsubmodule` ecosystem to
check daily for newer commits:

```yaml
updates:
  - package-ecosystem: 'gitsubmodule'
    directory: '/'
    allow:
      - dependency-name: 'external/vscode-common-python-lsp'
    schedule:
      interval: 'daily'
```

This is a scheduled check, not a workflow triggered by each push. Dependabot
updates the pinned submodule commit when the tracked upstream branch has
advanced. GitHub releases continue to provide versioned milestones and release
notes, but they do not trigger or gate the submodule updates.

### Optional configuration

Extensions whose servers run tools using the interpreter in each resolved
settings entry can opt in to per-project environments:

```ts
const toolConfig: ToolConfig = {
    // ...
    supportsPerProjectEnvironments: true,
};
```

The extension must also contribute a window-scoped
`<toolId>.usePerProjectEnvironments` boolean setting. When both are enabled,
the singleton language server receives settings for the projects reported by
the Python Environments extension and uses each project's selected interpreter.
Explicit `<toolId>.interpreter` settings continue to take precedence. The
setting defaults to `false`, so existing workspace-folder behavior is
unchanged.

To restart the language server whenever packages are installed or removed,
an extension sets `refreshExtensionOnPackagesChange: true` on the `ToolConfig` it
passes in. The key defaults to `false`; when set to `true`, the shared activation logic
subscribes once to the package-change events reported by the
[Python Environments extension](https://github.com/microsoft/vscode-python-environments)
during initialization and restarts the server on each one. The automatic refresh
wiring is internal; the underlying `IPythonApi.onDidChangePackages` event remains
available for consumers that need it.

## Version Requirements

| Runtime    | Minimum Version |
|------------|----------------|
| Python     | 3.10+          |
| Node.js    | 18+            |
| VS Code    | 1.74.0+        |

## Contributing

This project welcomes contributions and suggestions. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

[MIT](LICENSE)
