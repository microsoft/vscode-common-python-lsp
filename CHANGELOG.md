# Changelog

All notable changes to the `vscode-common-python-lsp` package will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **TypeScript** `ToolConfig.refreshExtensionOnPackageChange` — opt-in key that,
  when set to `true`, makes the shared activation logic restart the language
  server whenever the active environment's package managers report a package
  change (install/uninstall). The provider subscribes to the underlying
  package-change event once during initialization; the event is handled entirely
  inside the package and is not exposed as public API. The key defaults to
  `false`, so existing extensions are unaffected until they opt in. The legacy
  `ms-python.python` extension does not expose package events, so this has no
  effect unless the Python Environments extension is available.

## [0.7.0] - 2026-06-17

### Added

- **TypeScript** `ToolConfig.isFormatter` — optional boolean flag for tool
  extensions that provide LSP-based document formatting
  (`textDocument/formatting`, `rangeFormatting`, `rangesFormatting`).

- **TypeScript** `NullFormatter` class — a lifecycle-aware placeholder
  `DocumentFormattingEditProvider`. It registers a no-op formatter at
  activation time (so VS Code lists the extension in the formatter picker
  *before* the LSP has finished starting) and exposes `register()`,
  `unregister()`, `isRegistered()`, and `dispose()` for manual control.
  Exported from the package root.

- **TypeScript** `createToolContext` — when `ToolConfig.isFormatter` is
  `true`, the shared activation pattern now automatically:
  - registers the `NullFormatter` placeholder immediately at activation,
  - disposes it when the language client transitions to `State.Running`
    (including the "already Running" case where the initial transition would
    otherwise be missed),
  - re-registers it if the client later transitions to `State.Stopped` or
    `State.Starting` (e.g. during a restart), and disposes it again on the
    next `Running`,
  - disposes it on `ctx.dispose()` / `deactivateServer()`.

  This fixes the "duplicate formatter entry" regression reported in
  [microsoft/vscode-black-formatter#752](https://github.com/microsoft/vscode-black-formatter/issues/752)
  and unblocks the same fix for other formatter extensions
  (`vscode-autopep8`, `vscode-isort`, …).

  Linter-only extensions (pylint, flake8, mypy, …) are unaffected — the
  placeholder is **not** registered when `isFormatter` is `false` or unset.

## [0.6.1] - 2026-06-17

### Fixed

- **TypeScript** `getServerCwd`: Broadened the per-document variable guard
  from a hardcoded `${file…}` / `${relativeFile…}` allowlist to a general
  `${…}` check.  Any token still unresolved at spawn-time (including
  tool-specific tokens like mypy's `${nearestConfig}`) now correctly falls
  back to the workspace path instead of being passed verbatim to
  `child_process.spawn`, which caused an `ENOENT` error.
  (Fixes [microsoft/vscode-mypy#556](https://github.com/microsoft/vscode-mypy/issues/556))

## [0.4.0] - 2026-05-01

### Added

- **Python**: `update_environ_path()` — adds the virtual environment's scripts directory to PATH, ensuring tool executables are discoverable.

## [0.1.0] - 2025-04-20

### Added

- **TypeScript**: Logging utilities (`createOutputChannel`, `traceLog`, `traceError`, `traceWarn`, `traceInfo`, `traceVerbose`)
- **TypeScript**: Language status item registration and update helpers
- **TypeScript**: Server setup with `loadServerDefaults` for bundled Python server discovery
- **TypeScript**: Configuration file watcher factory (`createConfigFileWatchers`)
- **TypeScript**: VS Code API wrappers (`getConfiguration`, `getWorkspaceFolders`, etc.)
- **TypeScript**: Utility functions (resource URI helpers, `getProjectRoot`, interpreter/document checks)
- **TypeScript**: `.env` file parser (`getEnvVariables`)
- **TypeScript**: Full settings resolution pipeline (`IBaseSettings`, `getExtensionSettings`, `getGlobalSettings`, `getWorkspaceSettings`)
- **TypeScript**: Python environment provider (`PythonEnvironmentsProvider`) with interpreter change events
- **TypeScript**: Language server lifecycle management (`createServer`, `restartServer`)
- **TypeScript**: Extension activation pattern (`activateExtension`) with common subscriptions
- **TypeScript**: LSP handler registration helpers for document sync, formatting, code actions
- **Python**: LSP utilities (`shutdown_json_rpc`, `choose_working_directory`, file classification)
- **Python**: JSON-RPC runner infrastructure (`JsonRpc`, `run_over_json_rpc`, `get_or_start_json_rpc`)
- **Python**: Notebook cell-aware diagnostic mapping (`notebook_document_change`, `notebook_did_open`)
- **Python**: Subprocess message loop runner (`run_message_loop`, `RunResult`)
- **Python**: Code action / quick-fix edit builder (`build_quick_fix_edit`, `QuickFixRegistrationError`)
- **Python**: Diagnostic linting version tracker (`LintVersionTracker`)
- **Python**: Tool version detection and validation (`extract_version`, `check_min_version`)
- **Python**: Server infrastructure (`ToolServer`, `ToolServerConfig`, `ServerActivationConfig`)
