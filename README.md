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
├── python/                         # Python package (bundled server-side)
│   ├── vscode_common_python_lsp/   # Package source
│   │   └── __init__.py
│   ├── tests/                      # Python tests (pytest)
│   ├── pyproject.toml              # Package metadata & build config
│   └── requirements-dev.txt        # Dev/test dependencies
│
├── typescript/                     # TypeScript package (VS Code client-side)
│   ├── src/                        # Package source
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

## Python Package

The `vscode_common_python_lsp` Python package provides server-side utilities shared
across all five extensions: path resolution, context managers, tool execution runners,
JSON-RPC process management, and the LSP server factory.

### Development

```bash
cd python
pip install -e ".[dev]"
pytest tests/
```

## TypeScript Package

The `vscode-common-python-lsp` TypeScript package provides VS Code client-side
utilities: extension activation, server lifecycle, settings management, Python
interpreter resolution, and logging.

### Development

```bash
cd typescript
npm install
npm run build
npm test
```

## Consuming in Extensions

Consume this repository as a git submodule so the Python and TypeScript
libraries are pinned to the same commit. The VS Code Python tool extensions
place the checkout under `external/`:

```bash
git submodule add https://github.com/microsoft/vscode-common-python-lsp.git external/vscode-common-python-lsp
git submodule update --init --recursive
```

Clone a consuming extension with `--recurse-submodules`, or run the update
command above after cloning.

Reference the TypeScript package from the submodule in `package.json`:

```json
{
    "dependencies": {
        "@vscode/common-python-lsp": "file:external/vscode-common-python-lsp/typescript"
    }
}
```

Install the Python package directly from the same submodule commit when
building the extension bundle. For example, in `noxfile.py`:

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

The package manifests support building from the submodule. This repository no
longer publishes packages to npm or PyPI.

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
