# Shared TypeScript source

Shared TypeScript utilities for VS Code Python tool extensions.

Build this directory from a pinned repository checkout and import its `dist`
public entry point by a source-relative path. The private manifest name
`vscode-python-tool-internal` is only local build metadata, not a
published package or a supported bare-module import.

See the [main README](../README.md#consuming-in-extensions) for build order,
consumer type-checking and bundling instructions.

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
