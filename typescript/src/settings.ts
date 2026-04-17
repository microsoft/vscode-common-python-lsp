// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared settings utilities for VS Code Python tool extensions.
 *
 * Provides VS Code variable substitution, workspace/global settings
 * resolution, and configuration change detection — all parameterised
 * via {@link ToolConfig} so each extension only supplies its own
 * setting keys and defaults.
 */

import * as os from 'os';
import * as path from 'path';
import { ConfigurationChangeEvent, WorkspaceConfiguration, WorkspaceFolder } from 'vscode';
import { traceLog, traceWarn } from './logging';
import { IBaseSettings, ToolConfig } from './types';
import { getConfiguration, getWorkspaceFolders } from './vscodeapi';

// Re-export for convenience — callers that used these from the old
// settings module shouldn't have to change imports.
export { IBaseSettings };

// ---------------------------------------------------------------------------
// Variable substitution
// ---------------------------------------------------------------------------

/**
 * Resolves VS Code variable placeholders in an array of strings.
 *
 * Builds a substitution map and replaces all occurrences. The `${interpreter}`
 * token is handled specially: it is spliced into the array (replaced with the
 * full interpreter path segments) rather than string-substituted.
 */
export function resolveVariables(
    value: string[],
    workspace?: WorkspaceFolder,
    interpreter?: string[],
    env?: NodeJS.ProcessEnv,
): string[] {
    const substitutions = new Map<string, string>();
    const home = os.homedir();

    substitutions.set('${userHome}', home);

    if (workspace) {
        substitutions.set('${workspaceFolder}', workspace.uri.fsPath);
    }

    substitutions.set('${cwd}', process.cwd());
    getWorkspaceFolders().forEach((w) => {
        substitutions.set('${workspaceFolder:' + w.name + '}', w.uri.fsPath);
    });

    env = env || process.env;
    if (env) {
        for (const [key, value] of Object.entries(env)) {
            if (value) {
                substitutions.set('${env:' + key + '}', value);
            }
        }
    }

    // ${interpreter} is spliced in, not string-replaced
    const expanded: string[] = [];
    for (const v of value) {
        if (interpreter && v === '${interpreter}') {
            expanded.push(...interpreter);
        } else {
            expanded.push(v);
        }
    }

    return expanded.map((s) => {
        for (const [key, value] of substitutions) {
            s = s.split(key).join(value);
        }
        return expandTilde(s);
    });
}

/**
 * Expands a leading `~` to the user's home directory.
 */
export function expandTilde(value: string): string {
    if (value === '~') {
        return os.homedir();
    }
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
}

/**
 * Resolves a path setting value by substituting variables and making
 * relative paths absolute against the workspace root.
 */
export function resolvePathSetting(value: string, workspace: WorkspaceFolder): string {
    const resolved = resolveVariables([value], workspace)[0];
    if (!path.isAbsolute(resolved)) {
        return path.join(workspace.uri.fsPath, resolved);
    }
    return resolved;
}

// ---------------------------------------------------------------------------
// Settings resolution
// ---------------------------------------------------------------------------

function getCwd(config: WorkspaceConfiguration, workspace: WorkspaceFolder): string {
    const cwd = config.get<string>('cwd', workspace.uri.fsPath);
    return resolveVariables([cwd], workspace)[0];
}

/**
 * Resolve `extraPaths` for a workspace, falling back to
 * `python.analysis.extraPaths` when the tool-specific setting is empty.
 */
export function getExtraPaths(namespace: string, workspace: WorkspaceFolder): string[] {
    const config = getConfiguration(namespace, workspace);
    const extraPaths = config.get<string[]>('extraPaths', []);
    if (extraPaths.length > 0) {
        return extraPaths;
    }
    const pythonConfig = getConfiguration('python', workspace.uri);
    const legacyExtraPaths = pythonConfig.get<string[]>('analysis.extraPaths', []);
    if (legacyExtraPaths.length > 0) {
        traceLog('Using extraPaths from `python.analysis.extraPaths`.');
    }
    return legacyExtraPaths;
}

function getGlobalValue<T>(config: WorkspaceConfiguration, key: string, defaultValue: T): T {
    const inspect = config.inspect<T>(key);
    return inspect?.globalValue ?? inspect?.defaultValue ?? defaultValue;
}

/**
 * Resolve the interpreter from the extension's own `interpreter` setting.
 *
 * Separate from {@link getInterpreterFromSetting} in `utilities.ts` to avoid
 * a circular dependency with `python.ts`.
 */
function getInterpreterSettingValue(namespace: string, workspace?: WorkspaceFolder): string[] | undefined {
    const config = getConfiguration(namespace, workspace);
    return config.get<string[]>('interpreter');
}

/**
 * Resolve workspace settings for a single workspace folder.
 *
 * The returned object always contains the base keys defined in
 * {@link IBaseSettings}.  Tool-specific keys are populated from
 * `toolConfig.settingsDefaults` — each key is read from the
 * workspace configuration (or falls back to the default).
 *
 * @param namespace - Extension configuration namespace (e.g. `"flake8"`).
 * @param workspace - The workspace folder to resolve settings for.
 * @param toolConfig - Tool configuration providing setting defaults.
 * @param resolveInterpreter - Optional async function to resolve the Python
 *   interpreter when not set explicitly.  Typically this is
 *   `pythonProvider.getInterpreterDetails`.
 */
export async function getWorkspaceSettings(
    namespace: string,
    workspace: WorkspaceFolder,
    toolConfig: ToolConfig,
    resolveInterpreter?: (resource?: import('vscode').Uri) => Promise<{ path?: string[] }>,
): Promise<IBaseSettings> {
    const config = getConfiguration(namespace, workspace);

    let interpreter: string[] = [];
    if (resolveInterpreter) {
        interpreter = getInterpreterSettingValue(namespace, workspace) ?? [];
        if (interpreter.length === 0) {
            traceLog(`No interpreter found from setting ${namespace}.interpreter`);
            traceLog(
                `Getting interpreter from ms-python.python extension for workspace ${workspace.uri.fsPath}`,
            );
            interpreter = (await resolveInterpreter(workspace.uri)).path ?? [];
            if (interpreter.length > 0) {
                traceLog(
                    `Interpreter from ms-python.python extension for ${workspace.uri.fsPath}:`,
                    `${interpreter.join(' ')}`,
                );
            }
        } else {
            traceLog(`Interpreter from setting ${namespace}.interpreter: ${interpreter.join(' ')}`);
        }

        if (interpreter.length === 0) {
            traceLog(
                `No interpreter found for ${workspace.uri.fsPath} in settings or from ms-python.python extension`,
            );
        }
    }

    // Base settings (common to all extensions)
    const settings: IBaseSettings = {
        cwd: getCwd(config, workspace),
        workspace: workspace.uri.toString(),
        args: resolveVariables(config.get<string[]>('args', []), workspace),
        path: resolveVariables(config.get<string[]>('path', []), workspace, interpreter).map(expandTilde),
        interpreter: resolveVariables(interpreter, workspace),
        importStrategy: config.get<string>('importStrategy', 'useBundled'),
        showNotifications: config.get<string>('showNotifications', 'off'),
    };

    // Tool-specific settings from ToolConfig.settingsDefaults
    for (const [key, defaultValue] of Object.entries(toolConfig.settingsDefaults)) {
        settings[key] = config.get(key, defaultValue);
    }

    // Handle extraPaths if the tool defines it
    if ('extraPaths' in toolConfig.settingsDefaults) {
        settings.extraPaths = resolveVariables(getExtraPaths(namespace, workspace), workspace).map(expandTilde);
    }

    // Tilde expansion on cwd
    if (typeof settings.cwd === 'string' && settings.cwd.startsWith('~')) {
        settings.cwd = expandTilde(settings.cwd);
    }

    return settings;
}

/**
 * Resolve global (user-level) settings.
 */
export async function getGlobalSettings(
    namespace: string,
    toolConfig: ToolConfig,
    resolveInterpreter?: () => Promise<{ path?: string[] }>,
): Promise<IBaseSettings> {
    const config = getConfiguration(namespace);

    let interpreter: string[] = [];
    if (resolveInterpreter) {
        interpreter = getGlobalValue<string[]>(config, 'interpreter', []);
        if (interpreter === undefined || interpreter.length === 0) {
            interpreter = (await resolveInterpreter()).path ?? [];
        }
    }

    const settings: IBaseSettings = {
        cwd: getGlobalValue<string>(config, 'cwd', process.cwd()),
        workspace: process.cwd(),
        args: getGlobalValue<string[]>(config, 'args', []),
        path: getGlobalValue<string[]>(config, 'path', []),
        interpreter: interpreter ?? [],
        importStrategy: getGlobalValue<string>(config, 'importStrategy', 'fromEnvironment'),
        showNotifications: getGlobalValue<string>(config, 'showNotifications', 'off'),
    };

    // Tool-specific settings
    for (const [key, defaultValue] of Object.entries(toolConfig.settingsDefaults)) {
        settings[key] = getGlobalValue(config, key, defaultValue);
    }

    return settings;
}

/**
 * Resolve settings for all workspace folders.
 */
export function getExtensionSettings(
    namespace: string,
    toolConfig: ToolConfig,
    resolveInterpreter?: (resource?: import('vscode').Uri) => Promise<{ path?: string[] }>,
): Promise<IBaseSettings[]> {
    return Promise.all(
        getWorkspaceFolders().map((w) => getWorkspaceSettings(namespace, w, toolConfig, resolveInterpreter)),
    );
}

// ---------------------------------------------------------------------------
// Configuration change detection
// ---------------------------------------------------------------------------

/**
 * Check whether a configuration change event affects any of the tool's
 * tracked settings.
 *
 * @param e - The configuration change event from VS Code.
 * @param namespace - Extension configuration namespace (e.g. `"flake8"`).
 * @param trackedSettings - Setting keys to monitor (from {@link ToolConfig.trackedSettings}).
 */
export function checkIfConfigurationChanged(
    e: ConfigurationChangeEvent,
    namespace: string,
    trackedSettings: string[],
): boolean {
    const qualifiedSettings = trackedSettings.map((s) => `${namespace}.${s}`);
    return qualifiedSettings.some((s) => e.affectsConfiguration(s));
}

// ---------------------------------------------------------------------------
// Legacy settings logging
// ---------------------------------------------------------------------------

/**
 * Log deprecation warnings for legacy `python.linting.*` settings.
 *
 * This is tool-specific — each extension provides its own legacy key
 * names.  This helper provides the common logging pattern.
 */
export function logLegacySettings(
    namespace: string,
    legacyMappings: Array<{ legacyKey: string; newKey: string; isArray?: boolean }>,
): void {
    getWorkspaceFolders().forEach((workspace) => {
        try {
            const legacyConfig = getConfiguration('python', workspace.uri);

            for (const mapping of legacyMappings) {
                if (mapping.isArray) {
                    const value = legacyConfig.get<string[]>(mapping.legacyKey, []);
                    if (value.length > 0) {
                        traceWarn(`"python.${mapping.legacyKey}" is deprecated. Use "${namespace}.${mapping.newKey}" instead.`);
                        traceWarn(`"python.${mapping.legacyKey}" value for workspace ${workspace.uri.fsPath}:`);
                        traceWarn(`\n${JSON.stringify(value, null, 4)}`);
                    }
                } else {
                    const value = legacyConfig.get(mapping.legacyKey);
                    if (value) {
                        traceWarn(`"python.${mapping.legacyKey}" is deprecated. Use "${namespace}.${mapping.newKey}" instead.`);
                        traceWarn(
                            `"python.${mapping.legacyKey}" value for workspace ${workspace.uri.fsPath}: ${value}`,
                        );
                    }
                }
            }
        } catch (err) {
            traceWarn(`Error while logging legacy settings: ${err}`);
        }
    });
}
