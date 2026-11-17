# Consumer compatibility audit (S9)

This is a source audit for [S9](https://github.com/microsoft/vscode-common-python-lsp/issues/159),
reviewed on 2026-11-17. It records observed imports, composition and ownership,
not a census of every possible caller or a new runtime validation result.
**No shared entry point is sufficiently demonstrated to be superseded; no
deprecation annotations or runtime changes are introduced.**

## Reviewed revisions and method

| Consumer | Exact reviewed commit | S8 adoption PR |
|----------|-----------------------|----------------|
| Black | [`56828c28d96c85297fc3b5a6b2a0bf32afa44f9e`](https://github.com/microsoft/vscode-black-formatter/commit/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e) | [#851](https://github.com/microsoft/vscode-black-formatter/pull/851) |
| Flake8 | [`5cbebad763b1f551d358894e6cda39c4eca8f8e0`](https://github.com/microsoft/vscode-flake8/commit/5cbebad763b1f551d358894e6cda39c4eca8f8e0) | [#625](https://github.com/microsoft/vscode-flake8/pull/625) |
| isort | [`3246eb1b504b64a43f240146bf06e95321364eda`](https://github.com/microsoft/vscode-isort/commit/3246eb1b504b64a43f240146bf06e95321364eda) | [#806](https://github.com/microsoft/vscode-isort/pull/806) |
| mypy | [`35ff9df1d9d7bbfa132746ba602e01aa5dc37514`](https://github.com/microsoft/vscode-mypy/commit/35ff9df1d9d7bbfa132746ba602e01aa5dc37514) | [#669](https://github.com/microsoft/vscode-mypy/pull/669) |
| Pylint | [`f83e7b3dd8806aa443bf6e801222263021278a07`](https://github.com/microsoft/vscode-pylint/commit/f83e7b3dd8806aa443bf6e801222263021278a07) | [#933](https://github.com/microsoft/vscode-pylint/pull/933) |

All five gitlinks and checked-out shared submodules were
[`89cb5fc78d32dbdf5eb7d38d2b2bd78f0e6798a2`](https://github.com/microsoft/vscode-common-python-lsp/commit/89cb5fc78d32dbdf5eb7d38d2b2bd78f0e6798a2).
The consumer checkouts were clean and at the revisions above. Inspection used
immutable Git objects, not generated bundles or potentially changing worktree
files; no consumer or submodule was edited or rebuilt.

The audit followed shared imports through `src/extension.ts`, tool definitions
and local settings/status/runner adapters, then Python server handlers,
configuration, execution and compatibility wrappers. Build/install entry points,
tests, re-exports and dynamic test loaders were considered separately. Missing
direct imports do not establish lack of use: helpers are also reached through
shared composition, local adapters and separately launched runner scripts.

## TypeScript: observed imports and use

The runtime source imports the source-relative `typescript/dist` public entry
point. All five import `ToolConfig`, `IBaseSettings`, `loadServerDefaults`,
`getConfiguration` and `getWorkspaceFolders`. The configurations are explicitly
annotated `ToolConfig`, not `ToolDefinition<TSettings>`: the typed definition is
an available opt-in, not an already-completed migration.

| Consumer evidence | Activation and additional shared imports |
|-------------------|------------------------------------------|
| [Black client][black-ts], [configuration/settings][black-common] | `activateToolExtension`, `ToolExtensionRuntime`; `logLegacySettings` (locally aliased), `traceInfo`, `traceWarn`. Activation passes the configured tool, retains default-formatter/legacy-setting logging and awaits runtime deactivation. |
| [Flake8 client][flake8-ts], [configuration/settings][flake8-common] | `activateToolExtension`, `ToolExtensionRuntime`, `resolveExtensionRoot`, aliased `logLegacySettings`, `traceWarn`. Tool-specific legacy-setting messages remain local. |
| [isort client][isort-ts], [configuration/settings/runner][isort-common] | `createToolContext`, `ToolExtensionContext`, `deactivateServer`, `PythonEnvironmentsProvider`, `registerCommonSubscriptions`, `registerLogger`, `traceError`; local execution additionally uses `expandTilde`, aliased `getWorkspaceSettings`, `getEnvFileVars`, `getProjectRoot`, `getWorkspaceFolder`, `getDocumentSelector`, `traceLog` and `traceWarn`. |
| [mypy client][mypy-ts], [configuration/settings][mypy-common] | `activateToolExtension`, `ToolExtensionRuntime`, `resolveExtensionRoot`, aliased `logLegacySettings`, `traceWarn`. Activation retains its legacy-setting logging and awaits runtime deactivation. |
| [Pylint client][pylint-ts], [configuration/settings/status][pylint-common] | `activateToolExtension`, `ToolExtensionRuntime`, `resolveExtensionRoot`, aliased `logLegacySettings`, `traceWarn`, `onDidChangeConfiguration`; score UI imports `createLanguageStatusItem`, `createStatusBarItem`, `getDocumentSelector` and `onDidChangeActiveTextEditor`. The retained combined status-registration helper and the active score-only path are distinct. |

### Extension policy is still configuration, not shared machinery

The linked `src/common/constants.ts` definitions retain these custom settings
and capabilities:

- **Black:** `serverTransport`, with `isFormatter: true`; local settings code
  retains transport selection and formatter guidance.
- **Flake8:** `enabled`, `severity`, `ignorePatterns`, `extraPaths`.
- **isort:** `check`, `severity`, `extraPaths`; `serverEnabled` is tracked for
  restarts but is not a custom settings-payload key.
- **mypy:** `ignorePatterns`, `extraPaths`, `reportingScope`, `preferDaemon`,
  `daemonStatusFile`, `severity`; `supportsPerProjectEnvironments: true`.
- **Pylint:** `enabled`, `severity`, `ignorePatterns`, `lintOnChange`;
  `refreshExtensionOnPackagesChange: true`.

Pylint supplies both launch hooks in its linked client:
`getLaunchEnvironment` reads the unscoped `pylint.lintOnChange` configuration to
set/remove `VSCODE_PYLINT_LINT_ON_CHANGE`; `configureClient` registers
`pylint/score`, `pylint/lintingStarted` and `pylint/lintingFailed` handlers with
`registerDisposable`. The runtime owns those per-client registrations.
Pylint still owns its score UI and visibility listener through
`context.subscriptions`. This is evidence for the hook boundary, not a reason to
move UI policy into shared activation or hooks into serialized settings.

### isort needs manual composition

In [`src/extension.ts` lines 30–84][isort-ts], isort owns the output/logger and
Python provider, creates a tool context, and overrides `runServer` to switch
between LSP and local sort-import features when `serverEnabled` changes. It wires
common subscriptions, defers initialization and calls `deactivateServer` after
local-feature cleanup.

Its linked `settings.ts` wraps shared `getWorkspaceSettings` with
`python.sortImports.args`/`path` legacy fallbacks. `runner.ts` uses that wrapper,
workspace/root resolution and `getEnvFileVars` for local execution;
`sortImports.ts` registers local code actions using `getDocumentSelector`.
The activation facade does not replace this composition without changing
isort-specific lifecycle policy. Those lower-level APIs remain supported.

## Python: observed facade and lower-level usage

All five construct `ToolServer(ToolServerConfig(...), server=LSP_SERVER)`, keeping
their own pygls server and LSP handlers. All use document settings, CWD and facade
logging. Their server modules import `RunResult` and `update_environ_path`;
local `lsp_utils.py` adapters import `classify_python_file`.

| Consumer evidence | Settings, execution and lifecycle actually retained |
|-------------------|----------------------------------------------------|
| [Black server][black-py], [adapters][black-tool] | Root imports of `ToolServer`/`ToolServerConfig`; `apply_settings`, `log_startup_info`, global defaults, `execute_tool`, `handle_shutdown`/`handle_exit`. Formatting keeps `match_line_endings`, `strip_trailing_newline` and interpreter-based mode selection. |
| [Flake8 server][flake8-py], [adapters][flake8-tool] | Imports the facade from the public `server` module; initialization updates `global_settings` then calls `update_workspace_settings`, retaining extra-path setup and version logging. Uses global defaults, `execute_tool`, shutdown/exit helpers, `is_current_interpreter`, `is_match` and `QuickFixRegistrationError`. Classification adapters distinguish `PythonFileKind` values. |
| [isort server][isort-py], [adapters][isort-tool] | Imports the facade from `server`; initialization updates globals/workspaces and calls `get_settings_by_path` for extra paths. Uses global defaults, `execute_tool`, shutdown/exit helpers and `is_current_interpreter`; environment construction and import-sort policy remain local. |
| [mypy server][mypy-py], [adapters][mypy-tool] | Root facade imports; `apply_settings`, `log_startup_info`, global defaults, workspace updates, path/document lookup and `get_document_key`. Execution uses local `utils.run_path`, delegating to shared `run_path`, rather than `execute_tool`. Its adapter merges partial environments and calls shared `is_same_path` with symlink resolution. `is_match`/`normalize_path`, nearest-config CWD policy and daemon stop/kill handlers remain in use. |
| [Pylint server][pylint-py], [adapters][pylint-tool] | Root facade imports; `apply_settings`, `log_startup_info`, path/document lookup, `execute_tool`, shutdown/exit helpers, `is_current_interpreter`, `is_match` and `QuickFixRegistrationError`. Configuration keeps `default_settings` for enabled/severity/extra paths and `hardcoded_settings={"ignorePatterns": []}` for global defaults; workspace ignore patterns remain client-resolved. |

Black, Flake8, isort and mypy retain module-level `WORKSPACE_SETTINGS` and
`GLOBAL_SETTINGS` aliases to the facade dictionaries. Initialization, version
bookkeeping and mypy daemon cleanup also access that state. Replacing the
dictionaries or hiding their mutation behind new mandatory setters would not be
a documentation-only compatibility change.

Flake8/isort's manual settings application and the retained `_get_*`/`get_cwd`
wrappers are extension-local entry points, not competing new shared APIs.
Their presence does not justify removing shared facade methods or rewriting
consumer handlers.

### Runner scripts and compatibility re-exports matter

Black, Flake8, isort and Pylint retain the following in their linked adapters:

- `lsp_runner.py` imports `JsonRpc`, `RunResult`, `run_message_loop` and
  `run_module`, then runs `run_message_loop(RPC, run_module, RunResult)`.
  These are actual separately launched entry points, not dead imports merely
  because `lsp_server.py` uses `execute_tool`.
- `lsp_jsonrpc.py` imports/re-exports `JsonRpc`, `RpcRunResult`,
  `StreamClosedException`, `shutdown_json_rpc`, and wraps
  `get_or_start_json_rpc`/`run_over_json_rpc` with its local runner-script path.
  Retained wrapper exports are compatibility evidence, not proof that every
  exported name is invoked by each current server.
- `lsp_notebook.py` retains `MAGIC_LINE_RE`, `NOTEBOOK_SYNC_OPTIONS`,
  `CellOffset`, `SyntheticDocument`, `TextDocumentLike`, `build_notebook_source`,
  `get_cell_for_line` and `remap_diagnostics_to_cells` imports/re-exports.
  All four servers use notebook sync options; Flake8/Pylint also call notebook
  construction/remapping helpers.

Black's `lsp_utils.py` also preserves `run_module`/`run_path` wrappers, including
its compatibility timeout argument. mypy's active `run_path` wrapper and daemon
cleanup independently show why recommending `ToolServer` cannot deprecate
lower-level execution helpers.

### Separate test/build observations from runtime adoption

- All five environment-file unit tests import `getEnvFileVars`; mypy's
  `constants.unit.test.ts` additionally imports `getWorkspaceSettings`.
  These supplement, not replace, isort's runtime usage.
- All five `test_change_cwd.py` files import `SERVER_CWD` and `change_cwd`.
  Flake8's [stdlib test][flake8-stdlib-test] also imports `paths` and
  `reset_caches`; its [notebook test][flake8-notebook-test] imports
  `MAX_LSP_CHARACTER` from the public `notebook` module, not the package root.
- [Black][black-loader], [Flake8][flake8-loader] and [mypy][mypy-loader]
  CommonJS/VM tests intercept the shared entry with test doubles. Pylint's
  [lifecycle test][pylint-loader] also loads built `dist/server.js` with mocked
  collaborators to exercise launch behavior. That test-only deep load does not
  establish a recommended extension-runtime import path.
- Consumer `package.json`/build scripts build the pinned shared TypeScript
  source before extension compilation; each `noxfile.py` installs Python from
  the pinned checkout into `bundled/libs`. Packaging tests check the shared
  import and local-install metadata. These build/diagnostic distribution names
  are not npm/PyPI consumption APIs. This audit did not rebuild artifacts or
  claim to solve deferred build-provenance work.

## Compatibility decisions and replacement guidance

| Surface considered | Decision from this evidence |
|--------------------|-----------------------------|
| `ToolConfig` / `IBaseSettings` | Keep supported: all five import them. Recommend optional `ToolDefinition<TSettings>` / `ToolSettings<TSettings>` for stronger custom-setting types, not a mandatory or deprecated migration. |
| `createToolContext`, `registerCommonSubscriptions`, `deactivateServer`, provider/logging/settings helpers | Keep supported: isort's active manual lifecycle and local mode need them. Recommend `activateToolExtension` only where its ownership fits. |
| `restartServer` / `createServer` | Keep supported: shared activation composes these internally, and launch tests exercise that machinery. Lack of a direct import in these five runtime entry points is not evidence that these exports are unused or safely replaceable. |
| `ToolServer` settings methods and writable dictionaries | Keep the public facade and existing aliases. `_settings`/`_routing` are private stateless collaborators, not replacements or consumer customization points. No reviewed consumer imports them. Preserve shallow construction, in-place updates and distinct path/document fallbacks. |
| Python runner, JSON-RPC, notebook and path helpers | Keep supported: direct runner entry points, adapters and mypy's execution path remain evidence of lower-level use. A facade recommendation does not supersede these operations. |
| Legacy-setting logging and local compatibility wrappers | No shared deprecation: `logLegacySettings` is actively called. Messages about obsolete user settings do not deprecate the logging helper, and extension-local wrapper changes require their own caller evidence. |

Use the existing [typed definition](../typescript/README.md#typed-tool-definitions),
[activation](../typescript/README.md#opt-in-activation-facade) and
[hook](../typescript/README.md#optional-launch-hooks) guidance where applicable;
keep Python settings/routing access through `ToolServer`. None is a universal
drop-in replacement for the lower-level surfaces above.

Future deprecation proposals need revision-linked call-site evidence, a
behaviorally suitable replacement and a plan preserving existing callers,
including adapters, tests and manual lifecycles. This five-consumer snapshot
cannot establish absence of other callers. No exports, signatures, warnings,
defaults, dependencies or runtime behavior change as a result of this audit.

[black-ts]: https://github.com/microsoft/vscode-black-formatter/blob/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e/src/extension.ts
[black-common]: https://github.com/microsoft/vscode-black-formatter/tree/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e/src/common
[black-py]: https://github.com/microsoft/vscode-black-formatter/blob/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e/bundled/tool/lsp_server.py
[black-tool]: https://github.com/microsoft/vscode-black-formatter/tree/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e/bundled/tool
[flake8-ts]: https://github.com/microsoft/vscode-flake8/blob/5cbebad763b1f551d358894e6cda39c4eca8f8e0/src/extension.ts
[flake8-common]: https://github.com/microsoft/vscode-flake8/tree/5cbebad763b1f551d358894e6cda39c4eca8f8e0/src/common
[flake8-py]: https://github.com/microsoft/vscode-flake8/blob/5cbebad763b1f551d358894e6cda39c4eca8f8e0/bundled/tool/lsp_server.py
[flake8-tool]: https://github.com/microsoft/vscode-flake8/tree/5cbebad763b1f551d358894e6cda39c4eca8f8e0/bundled/tool
[isort-ts]: https://github.com/microsoft/vscode-isort/blob/3246eb1b504b64a43f240146bf06e95321364eda/src/extension.ts#L30-L84
[isort-common]: https://github.com/microsoft/vscode-isort/tree/3246eb1b504b64a43f240146bf06e95321364eda/src/common
[isort-py]: https://github.com/microsoft/vscode-isort/blob/3246eb1b504b64a43f240146bf06e95321364eda/bundled/tool/lsp_server.py
[isort-tool]: https://github.com/microsoft/vscode-isort/tree/3246eb1b504b64a43f240146bf06e95321364eda/bundled/tool
[mypy-ts]: https://github.com/microsoft/vscode-mypy/blob/35ff9df1d9d7bbfa132746ba602e01aa5dc37514/src/extension.ts
[mypy-common]: https://github.com/microsoft/vscode-mypy/tree/35ff9df1d9d7bbfa132746ba602e01aa5dc37514/src/common
[mypy-py]: https://github.com/microsoft/vscode-mypy/blob/35ff9df1d9d7bbfa132746ba602e01aa5dc37514/bundled/tool/lsp_server.py
[mypy-tool]: https://github.com/microsoft/vscode-mypy/tree/35ff9df1d9d7bbfa132746ba602e01aa5dc37514/bundled/tool
[pylint-ts]: https://github.com/microsoft/vscode-pylint/blob/f83e7b3dd8806aa443bf6e801222263021278a07/src/extension.ts
[pylint-common]: https://github.com/microsoft/vscode-pylint/tree/f83e7b3dd8806aa443bf6e801222263021278a07/src/common
[pylint-py]: https://github.com/microsoft/vscode-pylint/blob/f83e7b3dd8806aa443bf6e801222263021278a07/bundled/tool/lsp_server.py
[pylint-tool]: https://github.com/microsoft/vscode-pylint/tree/f83e7b3dd8806aa443bf6e801222263021278a07/bundled/tool
[black-loader]: https://github.com/microsoft/vscode-black-formatter/blob/56828c28d96c85297fc3b5a6b2a0bf32afa44f9e/build/extension.test.js
[flake8-loader]: https://github.com/microsoft/vscode-flake8/blob/5cbebad763b1f551d358894e6cda39c4eca8f8e0/src/test/runtime.test.cjs
[mypy-loader]: https://github.com/microsoft/vscode-mypy/blob/35ff9df1d9d7bbfa132746ba602e01aa5dc37514/build/setup-runtime.test.js
[pylint-loader]: https://github.com/microsoft/vscode-pylint/blob/f83e7b3dd8806aa443bf6e801222263021278a07/build/lifecycle.test.js#L169-L191
[flake8-stdlib-test]: https://github.com/microsoft/vscode-flake8/blob/5cbebad763b1f551d358894e6cda39c4eca8f8e0/src/test/python_tests/test_stdlib_detection.py#L186-L206
[flake8-notebook-test]: https://github.com/microsoft/vscode-flake8/blob/5cbebad763b1f551d358894e6cda39c4eca8f8e0/bundled/tool/tests/test_lsp_notebook.py#L18-L19
