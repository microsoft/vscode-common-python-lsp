# Supported architecture and adoption APIs

This repository supplies shared machinery, not a complete tool extension.
Extensions own tool policy and consume both runtimes from the same pinned source
revision. Follow the [build and bundling instructions](../README.md#consuming-in-extensions);
neither the internal npm name nor the Python distribution name is a public
registry dependency.

## Supported boundaries

Import TypeScript from the built `typescript/dist` public entry point, whose
exports are defined in [`src/index.ts`](../typescript/src/index.ts). Import Python
from `vscode_common_python_lsp` or its public modules, such as
`vscode_common_python_lsp.server`. The recommended composition path is:

```text
Extension-owned ToolDefinition<TSettings> (or existing ToolConfig)
  -> activateToolExtension(context, { serverInfo, toolConfig, hooks? })
  -> shared tool context, subscriptions and restart lifecycle
  -> per-launch environment and pre-start client hooks
  -> extension-owned Python LSP handlers using ToolServer
```

These are additive layers, not a requirement to migrate every caller to the
highest-level API. Public settings, interpreter, logging, execution and lifecycle
helpers remain available for custom composition.

| Boundary | Extension owns | Shared library owns |
|----------|----------------|---------------------|
| Definition and manifest | Tool identity, contributed settings and scopes, defaults, tracked keys, config filenames, script paths and capability opt-ins | Typed contracts, settings resolution, variable substitution and change detection |
| TypeScript activation | Choosing facade or manual composition, extension-specific commands and UI | Facade-owned resources, common subscriptions, interpreter integration and existing restart mechanics |
| Launch hooks | Environment patch policy and tool-specific notification handlers | Applying patches, creating/starting clients and disposing registered per-client resources |
| Python server | LSP handlers, tool arguments and execution-mode selection, diagnostics/formatting policy, tool-specific cleanup | `ToolServer` settings/routing facade, CWD resolution, execution dispatch, logging and JSON-RPC cleanup |
| Delivery | Pinning the checkout and building, bundling and testing both runtimes | Source and local build/install metadata; no npm/PyPI publication |

## TypeScript adoption

1. Define the tool's policy with `ToolDefinition<TSettings>` when custom settings
   need compile-time checking. Existing `ToolConfig` values remain supported.
   The [typed definition example](../typescript/README.md#typed-tool-definitions)
   shows a complete definition and the `getWorkspaceSettings`,
   `getGlobalSettings` and `getExtensionSettings` resolvers.
2. Pass that definition as `toolConfig` to
   `activateToolExtension(context, { serverInfo, toolConfig })`. Supply explicit
   `IServerInfo`, or use `loadServerDefaults(context.extensionPath)` with the
   extension's existing `package.json` `serverInfo`. The facade does not infer
   tool policy from the manifest.
3. Retain the returned `ToolExtensionRuntime` and await `runtime.deactivate()`
   from the extension's `deactivate`. The
   [activation example and lifetime contract](../typescript/README.md#opt-in-activation-facade)
   describe the complete entry point.
4. Add optional `ToolLifecycleHooks` only for runtime launch customization; see
   the [hook examples and ordering](../typescript/README.md#optional-launch-hooks).
   `getLaunchEnvironment` synchronously patches inherited environment values.
   `configureClient` synchronously registers handlers before `client.start()`;
   register their disposables immediately with `registerDisposable`. Do not
   start, stop or replace the client inside a hook.

The facade owns its output channel, logger registration, Python provider, tool
context and common subscriptions. It leaves unrelated
`context.subscriptions` entries alone. Listeners and any formatter placeholder
are installed synchronously, but initialization is deferred: the returned handle
does **not** mean the client is ready. Awaiting deactivation observes facade
cleanup, not a drain of every legacy restart or delayed retry. The logger and
status remain module-global, not isolated per tool instance.

### Manual lifecycle remains supported

isort's manual lifecycle is a supported use case, not obsolete boilerplate.
Extensions needing their own startup/restart orchestration can continue using
`PythonEnvironmentsProvider`, settings resolvers, `restartServer`, logging and
other exported helpers without adopting `activateToolExtension`.
`createToolContext`, `registerCommonSubscriptions` and `deactivateServer` also
remain available for callers composing those layers themselves.

Manual callers own the providers, listeners, timers and clients they create and
must stop/dispose them on replacement and shutdown. `restartServer` accepts
`ToolLifecycleHooks` and an optional shutdown `signal`; its returned
`disposables` include the per-client setup scope. Its optional `clientSetup`
property refers to that same scope, not a second resource. `createServer` is an
unstarted-client factory and accepts only the environment hook; it does not
perform the complete restart or pre-start handler-registration lifecycle.

## Python adoption: keep ToolServer as the facade

Each extension retains its `lsp_server.py`, its handlers and its tool-specific
execution policy. Construct `ToolServer(config, *, server=None)` with a
`ToolServerConfig`; optionally supply an existing pygls `LanguageServer`.
Otherwise the facade creates one and exposes it as `tool.server`.
For example, in the extension's bundled server:

```python
import pathlib

import lsprotocol.types as lsp
from vscode_common_python_lsp import ToolServer, ToolServerConfig

tool = ToolServer(
    ToolServerConfig(
        tool_module="example",
        tool_display="Example",
        runner_script=str(pathlib.Path(__file__).with_name("lsp_runner.py")),
        default_settings={"enabled": True},
    )
)
server = tool.server


@server.feature(lsp.INITIALIZE)
def initialize(params: lsp.InitializeParams) -> None:
    tool.apply_settings(params)
    tool.log_startup_info((params.initialization_options or {}).get("settings"))


@server.feature(lsp.SHUTDOWN)
def shutdown(_params: object) -> None:
    tool.handle_shutdown()


@server.feature(lsp.EXIT)
def exit_server(_params: object) -> None:
    tool.handle_exit()


if __name__ == "__main__":
    server.start_io()
```

The example assumes the extension bundles its own `lsp_runner.py`; it does not
register tool requests or choose how to run the tool. Add those handlers on
`server`, using the facade as needed:

| Public facade methods | Purpose |
|-----------------------|---------|
| `apply_settings(params)`, `get_global_defaults()`, `update_workspace_settings(settings)` | Apply the initialization payload and build/select configured settings |
| `get_settings_by_path(file_path)`, `get_document_key(document)`, `get_settings_by_document(document)` | Route filesystem paths and documents to current workspace settings |
| `get_cwd(settings, document=None, *, document_path=None)` | Finish per-document CWD substitution, optionally using a notebook's file path |
| `execute_tool(*, argv, mode, settings, ...)` | Dispatch caller-built arguments to `"path"`, `"rpc"` or `"module"` execution and return `RunResult` |
| `log_startup_info(settings=None)`, `log_to_output`, `log_error`, `log_warning`, `log_always` | Shared output and notification behavior |
| `handle_shutdown()`, `handle_exit()` | Shut down shared JSON-RPC processes; retain any tool-specific cleanup in the extension |

See [`ToolServerConfig` and `ToolServer`](../python/vscode_common_python_lsp/server.py)
for full signatures, including execution environment/timeout options and the RPC
workspace requirement. Public runner, JSON-RPC, diagnostics, formatting and
notebook helpers remain available; the facade does not replace every lower-level
operation.

## Configuration and private implementation

The TypeScript definition is policy, not a runtime schema. The manifest still
contributes user-facing settings. `settingsDefaults` selects custom keys for
resolution; `trackedSettings` independently selects keys that trigger a restart.
A client-only key can be tracked without entering the Python payload.
`ToolDefinition<TSettings>` checks defaults and resolver types at compile time;
unknown future settings remain `unknown` and require narrowing.

`IInitOptions` preserves the `{ settings, globalSettings }` wire shape.
TypeScript resolves host/workspace variables; Python finishes per-document CWD
variables. Keep the two sides' custom defaults and capabilities consistent.
Python's `ToolServerConfig.default_settings` extends global defaults;
`hardcoded_settings` overrides those global defaults even when the client sends
the same global keys. Workspace settings are then shallowly overlaid, not deeply
merged.

`ToolServer` owns the writable `global_settings` and `workspace_settings`
dictionaries. Existing aliases and in-place updates remain valid.
[`_settings`](../python/vscode_common_python_lsp/_settings.py) only constructs
fresh shallow dictionaries, retaining nested value aliases.
[`_routing`](../python/vscode_common_python_lsp/_routing.py) consults the facade's
current state and methods on each call; it owns no persistent state or cache.
Neither private module is an extension import or customization boundary.

Do not substitute one routing method for another: path lookup can fall back to
the first workspace, `get_document_key` can return `None`, and a document outside
known workspaces receives parent-directory fallback settings. Preserve these
distinctions and path normalization when changing internals; see the
[settings boundary tests](../CONTRIBUTING.md#settings-boundary-tests).

## Adding functionality at the right boundary

Keep new tool-specific defaults, argument ordering, result interpretation and UI
in the extension. Prefer a typed definition for declarative policy and the
existing hooks for environment/notification customization. Keep functions and
client resources out of serialized settings.

Add reusable mechanics to the shared public facade or exported helpers only
when their ownership and compatibility contract are clear. Extend facade tests
before modifying private settings/routing collaborators, and verify manual as
well as facade-based consumers. Recommending the facade is not evidence that a
lower-level API can be deprecated or removed.
