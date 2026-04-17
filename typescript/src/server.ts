// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared LSP client lifecycle management for Python tool extensions.
 *
 * Provides {@link createServer} to build a configured {@link LanguageClient}
 * and {@link restartServer} to orchestrate the full stop → create → start
 * cycle.  Both are parameterised via {@link ToolConfig} so each extension
 * only supplies its own settings and paths.
 */

import * as fsapi from 'fs-extra';
import * as path from 'path';
import { Disposable, env, l10n, LanguageStatusSeverity, LogOutputChannel, Uri } from 'vscode';
import { State } from 'vscode-languageclient';
import {
    LanguageClient,
    LanguageClientOptions,
    RevealOutputChannelOn,
    ServerOptions,
} from 'vscode-languageclient/node';
import { getEnvFileVars } from './envFile';
import { traceError, traceInfo, traceVerbose } from './logging';
import { PythonEnvironmentsProvider } from './python';
import { getExtensionSettings, getGlobalSettings } from './settings';
import { updateStatus } from './status';
import { IBaseSettings, IInitOptions, ToolConfig } from './types';
import { getDocumentSelector, getLSClientTraceLevel } from './utilities';
import { getWorkspaceFolder } from './vscodeapi';

// ---------------------------------------------------------------------------
// CWD resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the working directory for spawning the server process.
 *
 * File-based variables (`${file*}`, `${relativeFile*}`) are resolved
 * per-document by the Python server at lint-time, not at spawn-time.
 * When the configured CWD still contains such a variable we fall back
 * to the workspace path so the process can start successfully.
 */
export function getServerCwd(settings: IBaseSettings): string {
    const hasFileVariable = /\$\{(file|relativeFile)/.test(settings.cwd);
    return hasFileVariable ? Uri.parse(settings.workspace).fsPath : settings.cwd;
}

// ---------------------------------------------------------------------------
// Server creation
// ---------------------------------------------------------------------------

export interface CreateServerOptions {
    settings: IBaseSettings;
    serverId: string;
    serverName: string;
    outputChannel: LogOutputChannel;
    initializationOptions: IInitOptions;
    toolConfig: ToolConfig;
    debuggerPath?: string;
}

/**
 * Create a configured {@link LanguageClient} for a Python tool extension.
 *
 * Builds the server environment (env file, debugger, PYTHONUTF8, extraPaths,
 * tool-specific env vars), resolves the CWD, chooses the correct server
 * script, and returns a ready-to-start client.
 */
export async function createServer(options: CreateServerOptions): Promise<LanguageClient> {
    const { settings, serverId, serverName, outputChannel, initializationOptions, toolConfig, debuggerPath } = options;

    if (!settings.interpreter.length) {
        const message = l10n.t(
            'Unable to start {0}: no Python interpreter executable is configured.',
            serverName,
        );
        updateStatus(message, LanguageStatusSeverity.Error);
        throw new Error(message);
    }

    const command = settings.interpreter[0];
    const cwd = getServerCwd(settings);

    // Build server environment
    const newEnv: Record<string, string | undefined> = { ...process.env };

    // Load environment variables from python.envFile (.env)
    const workspaceUri = Uri.parse(settings.workspace);
    const workspaceFolder = getWorkspaceFolder(workspaceUri);
    const envFileVars = workspaceFolder ? await getEnvFileVars(workspaceFolder) : {};
    for (const [key, val] of Object.entries(envFileVars)) {
        if ((key === 'PYTHONPATH' || key === 'PATH') && newEnv[key]) {
            newEnv[key] = newEnv[key] + path.delimiter + val;
        } else {
            newEnv[key] = val;
        }
    }

    // Debugger path — only enable when USE_DEBUGPY is explicitly 'true'/'1'.
    // This matches the upstream extension pattern: debug is opt-in, and
    // USE_DEBUGPY is forced to 'False' by default so the Python server
    // does not attempt to import debugpy unless explicitly requested.
    const useDebugpy = (newEnv.USE_DEBUGPY ?? '').toLowerCase();
    if ((useDebugpy === 'true' || useDebugpy === '1') && debuggerPath) {
        newEnv.DEBUGPY_PATH = debuggerPath;
    } else {
        if (useDebugpy === 'true' || useDebugpy === '1') {
            traceInfo('USE_DEBUGPY is set but debuggerPath is unavailable — debug disabled.');
        }
        newEnv.USE_DEBUGPY = 'False';
    }

    // Standard env vars (identical across all repos)
    newEnv.LS_IMPORT_STRATEGY = settings.importStrategy;
    newEnv.LS_SHOW_NOTIFICATION = settings.showNotifications;

    // PYTHONUTF8 — default true, configurable via ToolConfig
    if (toolConfig.pythonUtf8 !== false) {
        newEnv.PYTHONUTF8 = '1';
    }

    // Extra paths → PYTHONPATH
    if (Array.isArray(settings.extraPaths) && settings.extraPaths.length > 0) {
        const existing = newEnv.PYTHONPATH ? newEnv.PYTHONPATH.split(path.delimiter) : [];
        const combined = [...existing, ...settings.extraPaths].filter((dir) => dir.length > 0);
        newEnv.PYTHONPATH = combined.join(path.delimiter);
        traceInfo(`PYTHONPATH: ${newEnv.PYTHONPATH}`);
    }

    // Tool-specific extra env vars — applied AFTER built-in assignments.
    // A warning is logged when a key collides with a built-in to surface
    // potential silent overrides.
    const BUILT_IN_ENV_KEYS = new Set([
        'USE_DEBUGPY', 'DEBUGPY_PATH', 'LS_IMPORT_STRATEGY', 'LS_SHOW_NOTIFICATION', 'PYTHONUTF8', 'PYTHONPATH',
    ]);
    if (toolConfig.extraEnvVars) {
        for (const [key, val] of Object.entries(toolConfig.extraEnvVars)) {
            if (BUILT_IN_ENV_KEYS.has(key)) {
                traceInfo(`extraEnvVars: "${key}" overrides built-in value — this may cause unexpected behavior.`);
            }
            newEnv[key] = val;
        }
    }

    // Choose server script (debug vs normal)
    const isDebugScript = toolConfig.debugServerScript
        ? await fsapi.pathExists(toolConfig.debugServerScript)
        : false;
    const scriptPath =
        newEnv.USE_DEBUGPY !== 'False' && isDebugScript && toolConfig.debugServerScript
            ? toolConfig.debugServerScript
            : toolConfig.serverScript;

    const args = settings.interpreter.slice(1).concat([scriptPath]);
    traceInfo(`Server run command: ${[command, ...args].join(' ')}`);
    traceInfo(`Server CWD: ${cwd}`);
    traceVerbose(
        `Server environment: LS_IMPORT_STRATEGY=${newEnv.LS_IMPORT_STRATEGY}, ` +
            `LS_SHOW_NOTIFICATION=${newEnv.LS_SHOW_NOTIFICATION}` +
            (newEnv.PYTHONUTF8 ? `, PYTHONUTF8=${newEnv.PYTHONUTF8}` : ''),
    );

    const serverOptions: ServerOptions = {
        command,
        args,
        options: { cwd, env: newEnv },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: getDocumentSelector(),
        outputChannel: outputChannel,
        traceOutputChannel: outputChannel,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        initializationOptions,
    };

    return new LanguageClient(serverId, serverName, serverOptions, clientOptions);
}

// ---------------------------------------------------------------------------
// Server restart lifecycle
// ---------------------------------------------------------------------------

export interface RestartServerOptions {
    settings: IBaseSettings;
    serverId: string;
    serverName: string;
    outputChannel: LogOutputChannel;
    toolConfig: ToolConfig;
    pythonProvider: PythonEnvironmentsProvider;
}

/** Result of {@link restartServer} — caller owns the disposables. */
export interface RestartServerResult {
    client: LanguageClient | undefined;
    disposables: Disposable[];
}

/**
 * Full server restart lifecycle: stop old → create new → start.
 *
 * Updates the language status item and returns the new client alongside
 * any disposables the caller should track.  Returns `client: undefined`
 * when creation or start fails.
 */
export async function restartServer(
    options: RestartServerOptions,
    oldLsClient?: LanguageClient,
): Promise<RestartServerResult> {
    const { settings, serverId, serverName, outputChannel, toolConfig, pythonProvider } = options;

    if (oldLsClient) {
        traceInfo('Server: Stop requested');
        try {
            await oldLsClient.stop();
        } catch (ex) {
            traceError(`Server: Stop failed: ${ex}`);
        }
    }

    updateStatus(undefined, LanguageStatusSeverity.Information, true);

    const resolveInterpreter = pythonProvider.getInterpreterDetails.bind(pythonProvider);
    const debuggerPath = await pythonProvider.getDebuggerPath();

    let newLSClient: LanguageClient;
    try {
        newLSClient = await createServer({
            settings,
            serverId,
            serverName,
            outputChannel,
            toolConfig,
            debuggerPath,
            initializationOptions: {
                settings: await getExtensionSettings(serverId, toolConfig, resolveInterpreter),
                globalSettings: await getGlobalSettings(serverId, toolConfig),
            },
        });
    } catch (ex) {
        updateStatus(l10n.t('Server failed to start.'), LanguageStatusSeverity.Error);
        traceError(`Server: Creation failed: ${ex}`);
        return { client: undefined, disposables: [] };
    }

    traceInfo('Server: Start requested.');
    const serverCwd = getServerCwd(settings);
    try {
        await newLSClient.start();
        await newLSClient.setTrace(getLSClientTraceLevel(outputChannel.logLevel, env.logLevel));
    } catch (ex) {
        updateStatus(l10n.t('Server failed to start.'), LanguageStatusSeverity.Error);
        traceError(`Server: Start failed (CWD: ${serverCwd}): ${ex}`);
        try {
            newLSClient.dispose();
        } catch {
            // best-effort cleanup
        }
        return { client: undefined, disposables: [] };
    }

    // Explicitly clear busy status after successful start — the state
    // listener below only catches future transitions and may miss the
    // initial Running state.
    updateStatus(undefined, LanguageStatusSeverity.Information, false);

    // Register state listener only after successful start
    const disposables: Disposable[] = [];
    disposables.push(
        newLSClient.onDidChangeState((e) => {
            switch (e.newState) {
                case State.Stopped:
                    traceVerbose('Server State: Stopped');
                    break;
                case State.Starting:
                    traceVerbose('Server State: Starting');
                    break;
                case State.Running:
                    traceVerbose('Server State: Running');
                    updateStatus(undefined, LanguageStatusSeverity.Information, false);
                    break;
            }
        }),
    );

    return { client: newLSClient, disposables };
}
