# Shared TypeScript source

Shared TypeScript utilities for VS Code Python tool extensions.

Build this directory from a pinned repository checkout and import its `dist`
public entry point by a source-relative path. The private manifest name
`vscode-python-tool-internal` is only local build metadata, not a
published package or a supported bare-module import.

See the [main README](../README.md#consuming-in-extensions) for build order,
consumer type-checking and bundling instructions.

## Opt-in activation facade

For conventional tools, `activateToolExtension` composes the existing shared
helpers. It accepts explicit `IServerInfo` and either a legacy `ToolConfig` or
a `ToolDefinition<TSettings>`; it does not load a manifest or infer tool policy.
For example, in the consuming extension's `src/extension.ts`:

```typescript
import { ExtensionContext } from 'vscode';
import {
    activateToolExtension,
    loadServerDefaults,
    ToolExtensionRuntime,
} from '../external/vscode-common-python-lsp/typescript/dist';
import { toolDefinition } from './toolDefinition';

let runtime: ToolExtensionRuntime | undefined;

export function activate(context: ExtensionContext): void {
    runtime = activateToolExtension(context, {
        serverInfo: loadServerDefaults(context.extensionPath),
        toolConfig: toolDefinition,
    });
}

export async function deactivate(): Promise<void> {
    await runtime?.deactivate();
    runtime = undefined;
}
```

`toolDefinition` supplies the extension's existing policies and server script
path (see the typed example below). Build the pinned shared checkout before
type-checking and bundle its public entry and dependencies as described in the
main README.

The facade installs common listeners and, for formatters, the placeholder
synchronously, then initializes with `setImmediate`. **The returned handle is
not a client-ready promise**: Python resolution and client startup remain
deferred. Common listeners are present before Python can emit its initial
interpreter event.

The facade owns its output channel, logger registration, Python provider,
tool context, commands, watchers and listeners. It adds one cleanup disposable
to `context.subscriptions`; it does not remove or dispose unrelated caller
subscriptions. Context disposal initiates shutdown; `await runtime.deactivate()`
observes it. Both paths are idempotent. Shutdown cancels pending initialization,
disposes the tool context, and delegates client stopping to `deactivateServer`.
If initialization already started, shutdown waits for that `initialize()` call
to settle and disposes any late subscriptions immediately; unresolved Python
API acquisition can therefore delay shutdown. Logging stays available during
this cleanup. Synchronous activation failures roll back owned resources and
are rethrown; asynchronous initialization/cleanup failures are caught and logged.

This is composition, not a new restart scheduler. As with the low-level APIs,
`runServer()` may resolve after scheduling a delayed retry, and shutdown does
**not** drain every in-flight restart/start (including startup triggered by a
Python event). No stronger client-readiness or full-quiescence guarantee is
implied. Logger and status are still module-global: this is not independent
multi-tool-instance isolation. Existing low-level activation APIs remain
available unchanged for custom composition; no consumer migration or custom
lifecycle hooks are required.

## Optional launch hooks

Pass `hooks` to `activateToolExtension` or `createToolContext` for runtime-only
customization. `getLaunchEnvironment({ settings, serverId, serverName })`
synchronously returns an environment patch for each actual client-creation
attempt, not each debounced restart request. It must not mutate settings or
`process.env`. An omitted key preserves its inherited value, `''` sets an empty
value, and an explicit `undefined` removes the inherited key.

The patch is applied to a fresh copy of `process.env` **before** env-file merging,
debugger/built-in assignments, extra paths and finally static `extraEnvVars`.
Thus an env file can reintroduce a removed inherited key; static overrides keep
their existing precedence. A throwing hook fails that launch through the normal
creation-error path. Hooks are not part of `ToolConfig` or the Python settings
payload. Existing callers without hooks retain their environment behavior.

`configureClient({ client, settings, serverId, serverName, registerDisposable })`
registers tool-specific handlers on the new client **before** `client.start()`.
For example, add this property alongside `serverInfo` and `toolConfig` in the
activation options:

```typescript
hooks: {
    configureClient: ({ client, registerDisposable }) => {
        registerDisposable(client.onNotification('example/score', (score: number) => {
            // Update extension-owned UI here.
        }));
    },
},
```

Register each returned disposable immediately, so earlier registrations can be
released if later setup throws. The callback must finish synchronously and
return no value; its `undefined` return type deliberately rejects async callbacks.
Do not start, stop or replace the client from this hook. The runtime owns client
lifetime; tool-specific UI stays owned by the extension.

Each actual client generation has an idempotent setup scope, separate from
post-start state listeners. It is closed on setup/start/trace failure, retirement
after an old stop settles or replacement takes ownership, missing-interpreter
retirement, and shutdown. Registrations added to an already closed scope are
disposed immediately. Cleanup errors are contained. Shutdown closes scopes even
while creation/start is pending; it still does not promise to interrupt or drain
every in-flight lifecycle operation. A late successful start is stopped.

Lower-level `restartServer` callers can pass the same hooks and an optional
shutdown `signal`. Its returned `disposables` include the setup scope. The optional
`clientSetup` result property identifies that same scope for custom composition
that needs to retire it separately from state listeners; it is not an additional
resource to dispose twice. `createServer` alone accepts only the environment hook
and remains an unstarted-client factory.

## Typed tool definitions

Adoption is optional. Annotate a definition with `ToolDefinition<TSettings>` to
check custom defaults and retain the declared types through all three settings
resolvers. The example belongs in an extension's `src/extension.ts`, after
building the checkout under `external/` as described above. Ordinary interfaces
work without an index signature:

```typescript
import { WorkspaceFolder } from 'vscode';
import {
    getExtensionSettings,
    getGlobalSettings,
    getWorkspaceSettings,
    IInitOptions,
    ToolConfig,
    ToolDefinition,
} from '../external/vscode-common-python-lsp/typescript/dist';

interface LintSettings {
    ignorePatterns: string[];
    severity: Record<string, string>;
    enabled: boolean;
    optionalLabel?: string;
}

const tool: ToolDefinition<LintSettings> = {
    toolId: 'example',
    toolDisplayName: 'Example',
    toolModule: 'example',
    minimumPythonVersion: { major: 3, minor: 10 },
    configFiles: ['tool.toml'],
    serverScript: 'bundled/tool/lsp_server.py', // Use the extension's server path.
    settingsDefaults: {
        ignorePatterns: [],
        severity: { E: 'Error' },
        enabled: false,
    },
    trackedSettings: ['args', 'path', 'interpreter', 'ignorePatterns', 'severity', 'envFile'],
};

// Also accepted directly as createToolContext({ ..., toolConfig: tool }).
export const legacyCompatible: ToolConfig = tool;

export async function resolveExampleSettings(workspace: WorkspaceFolder) {
    const resolved = await getWorkspaceSettings('example', workspace, tool);
    const patterns: string[] = resolved.ignorePatterns;
    const enabled: boolean = resolved.enabled;
    const optionalLabel: string | undefined = resolved.optionalLabel;
    const futureOption: unknown = resolved.futureOption; // Narrow before use.

    const initializationOptions: IInitOptions = {
        settings: await getExtensionSettings('example', tool, undefined, [workspace]),
        globalSettings: await getGlobalSettings('example', tool),
    };
    return { patterns, enabled, optionalLabel, futureOption, initializationOptions };
}
```

Use the explicit annotation to retain the full declared types: `false` and `[]`
are defaults, not literal restrictions on resolved values. Required custom
fields require defaults. Optional fields remain optional; omitting a default
also omits that field from resolution, even if it is configured. Common fields
keep their existing `IBaseSettings` types and cannot be contradicted by the
custom declaration. `ToolSettings<TSettings>` names the resulting open settings
type; future wire fields stay `unknown`.

The resolver signatures infer custom fields from the supplied configuration's
`settingsDefaults`. An unparameterized `ToolConfig` retains the legacy
`IBaseSettings` surface. Definitions also pass directly to existing lifecycle
APIs; no generic lifecycle classes or migration are required.

This is a compile-time contract, not runtime validation or a schema.
Configuration values, shallow replacement, variable resolution, manifest
defaults and the `{ settings, globalSettings }` initialization payload are
unchanged. Only custom keys in `settingsDefaults` are projected. Keep
`trackedSettings` explicit: a client-only key such as `envFile` may be watched
without being serialized.
