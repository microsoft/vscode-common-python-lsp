# Changelog

All notable changes to the `vscode-common-python-lsp` package will be
documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
