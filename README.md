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

### Multi-root workspaces

The TypeScript package uses a **singleton** language-server model: a single
server is started for the whole window (rooted at the folder returned by
`getProjectRoot()`), and settings for every workspace folder are forwarded to it
via `getExtensionSettings()`. This avoids spawning a redundant server process
per folder in multi-root workspaces.

To let users disable a tool for individual folders (e.g. `pylint.enabled: false`
in one folder of a multi-root workspace), the package honours a per-folder
`<namespace>.enabled` boolean:

- `getExtensionSettings(namespace, toolConfig, resolveInterpreter)` automatically
  omits folders where the tool is disabled, so the shared server never lints
  opted-out folders.
- `isToolEnabledForWorkspace(namespace, workspaceFolder, settingKey?)` reports
  whether the tool is enabled for a single folder. Pass `settingKey` when a tool
  uses a different key (e.g. `'enable'`); it defaults to `'enabled'`.
- `getEnabledWorkspaceFolders(namespace, settingKey?)` returns only the folders
  for which the tool is enabled — useful when registering per-folder providers.

Folders default to enabled when the setting is unset, so behaviour is unchanged
for tools that don't expose an `enabled` setting.

## Consuming in Extensions

**Git submodule (current):**
```bash
git submodule add https://github.com/microsoft/vscode-common-python-lsp.git submodules/vscode-common-python-lsp
```

**Python side** — install into `bundled/libs/` via noxfile.
**TypeScript side** — `file:` dependency in `package.json`.

### Optional configuration

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
