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

**Git submodule (current):**
```bash
git submodule add https://github.com/microsoft/vscode-common-python-lsp.git submodules/vscode-common-python-lsp
```

**Python side** — install into `bundled/libs/` via noxfile.
**TypeScript side** — `file:` dependency in `package.json`.

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
