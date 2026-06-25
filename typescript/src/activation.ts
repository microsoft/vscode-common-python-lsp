// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared activation / deactivation pattern for Python tool extensions.
 *
 * Provides {@link createToolContext} to build a {@link ToolExtensionContext}
 * that manages the debounced server lifecycle, and
 * {@link registerCommonSubscriptions} to wire up all shared VS Code
 * subscriptions (commands, watchers, listeners).
 */

import * as vscode from 'vscode';
import { State } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';
import { createConfigFileWatchers } from './configWatcher';
import { traceError, traceLog, traceVerbose } from './logging';
import { NullFormatter } from './nullFormatter';
import { PythonEnvironmentsProvider } from './python';
import { restartServer, RestartServerOptions } from './server';
import { checkIfConfigurationChanged, getWorkspaceSettings } from './settings';
import { registerLanguageStatusItem, updateStatus } from './status';
import { IServerInfo, ToolConfig } from './types';
import { getInterpreterFromSetting, getLSClientTraceLevel, getProjectRoot } from './utilities';
import { onDidChangeConfiguration, registerCommand } from './vscodeapi';

// ---------------------------------------------------------------------------
// Default restart delay
// ---------------------------------------------------------------------------

/** Fallback when {@link ToolConfig.restartDelay} is not set. */
const DEFAULT_RESTART_DELAY = 1000;

// ---------------------------------------------------------------------------
// ToolExtensionContext
// ---------------------------------------------------------------------------

/**
 * Manages the LanguageClient lifecycle for a tool extension.
 *
 * Created via {@link createToolContext} — holds the current client
 * reference, a debounced `runServer()`, and a deferred `initialize()`.
 */
export interface ToolExtensionContext {
    /** The current LanguageClient instance (`undefined` before first start). */
    lsClient: LanguageClient | undefined;

    /**
     * Debounced restart — safe to call from any trigger (config change,
     * interpreter change, etc.).
     *
     * **Note:** When a restart is already in progress, this schedules a
     * delayed retry and resolves immediately.  The returned promise does
     * *not* wait for the deferred restart to complete — callers should
     * treat this as fire-and-forget for event-handler use.
     */
    runServer(): Promise<void>;

    /**
     * Deferred initialisation — call from `setImmediate` in `activate()`.
     *
     * Checks whether an interpreter is already configured.  If so,
     * starts the server immediately; otherwise defers to the Python
     * extension's interpreter resolution.
     */
    initialize(subscriptions: vscode.Disposable[]): Promise<void>;

    /**
     * Dispose all internal resources (timers, state listeners).
     *
     * Call from the extension's `deactivate()` to prevent orphaned
     * server processes from debounce timers firing after shutdown.
     */
    dispose(): void;
}

/** Options for {@link createToolContext}. */
export interface CreateToolContextOptions {
    serverInfo: IServerInfo;
    outputChannel: vscode.LogOutputChannel;
    toolConfig: ToolConfig;
    pythonProvider: PythonEnvironmentsProvider;
}

/**
 * Create a {@link ToolExtensionContext} that manages the server lifecycle.
 *
 * The returned context provides a debounced `runServer()` that prevents
 * concurrent restarts and a deferred `initialize()` for first startup.
 */
export function createToolContext(options: CreateToolContextOptions): ToolExtensionContext {
    const { serverInfo, outputChannel, toolConfig, pythonProvider } = options;
    const serverId = toolConfig.toolId;
    const serverName = serverInfo.name;
    const restartDelay = toolConfig.restartDelay ?? DEFAULT_RESTART_DELAY;

    const minVersion = toolConfig.minimumPythonVersion;
    const pythonVersion = `${minVersion.major}.${minVersion.minor}`;

    let isRestarting = false;
    let restartTimer: NodeJS.Timeout | undefined;
    let disposed = false;
    let serverDisposables: vscode.Disposable[] = [];

    const nullFormatter = toolConfig.isFormatter ? new NullFormatter() : undefined;
    nullFormatter?.register();

    const ctx: ToolExtensionContext = {
        lsClient: undefined,

        async runServer(): Promise<void> {
            if (disposed) {
                return;
            }
            if (isRestarting) {
                if (restartTimer) {
                    clearTimeout(restartTimer);
                }
                restartTimer = setTimeout(() => ctx.runServer(), restartDelay);
                return;
            }
            isRestarting = true;
            try {
                // Re-register the placeholder at the start of each restart
                // cycle when there is no healthy running client.  This covers
                // two gaps the per-state listener misses:
                //  1. Extension-driven restarts (config/interpreter change):
                //     runServer() disposes the old state listener *before*
                //     restartServer() stops the previous client, so
                //     Stopped/Starting transitions fire into a dead listener.
                //  2. Failure paths: if restartServer() throws or returns
                //     client: undefined the state-listener block is skipped
                //     entirely.
                // The guard avoids re-introducing the duplicate-formatter
                // symptom: if the old client is still Running (serving
                // formatting requests), re-registering the placeholder would
                // make the extension appear twice in the formatter picker
                // until restartServer() stops the old client.
                if (nullFormatter && (!ctx.lsClient || ctx.lsClient.state !== State.Running)) {
                    nullFormatter.register();
                }

                const projectRoot = await getProjectRoot();
                if (disposed) {
                    return;
                }
                const resolveInterpreter = pythonProvider.getInterpreterDetails.bind(pythonProvider);
                const workspaceSetting = await getWorkspaceSettings(
                    serverId,
                    projectRoot,
                    toolConfig,
                    resolveInterpreter,
                );
                if (disposed) {
                    return;
                }
                if (workspaceSetting.interpreter.length === 0) {
                    // Stop any stale server running with the previous interpreter
                    if (ctx.lsClient) {
                        try {
                            await ctx.lsClient.stop();
                        } catch (ex) {
                            traceError(`Server: Stop failed: ${ex}`);
                        }
                        ctx.lsClient = undefined;
                    }
                    for (const d of serverDisposables) {
                        try {
                            d.dispose();
                        } catch (ex) {
                            traceError(`Failed to dispose: ${ex}`);
                        }
                    }
                    serverDisposables = [];

                    // Re-register the placeholder so the extension stays
                    // visible in the formatter picker while there is no
                    // interpreter (and therefore no running LSP formatter).
                    nullFormatter?.register();

                    updateStatus(
                        vscode.l10n.t('Please select a Python interpreter.'),
                        vscode.LanguageStatusSeverity.Error,
                    );
                    traceError(
                        'Python interpreter missing:\r\n' +
                            '[Option 1] Select Python interpreter using the ms-python.python extension.\r\n' +
                            '[Option 2] Use the ms-python.python-environments extension to manage environments.\r\n' +
                            `[Option 3] Set an interpreter using "${serverId}.interpreter" setting.\r\n` +
                            `Please use Python ${pythonVersion} or greater.`,
                    );
                } else {
                    // Dispose previous server state listeners
                    for (const d of serverDisposables) {
                        try {
                            d.dispose();
                        } catch (ex) {
                            traceError(`Failed to dispose: ${ex}`);
                        }
                    }
                    serverDisposables = [];

                    if (disposed) {
                        return;
                    }

                    const restartOptions: RestartServerOptions = {
                        settings: workspaceSetting,
                        serverId,
                        serverName,
                        outputChannel,
                        toolConfig,
                        pythonProvider,
                    };
                    const result = await restartServer(restartOptions, ctx.lsClient);

                    // Final disposed guard — don't assign if deactivated during restart
                    if (disposed) {
                        if (result.client) {
                            try {
                                await result.client.stop();
                                result.client.dispose();
                            } catch (ex) {
                                traceVerbose(`Dispose after deactivation: ${ex}`);
                            }
                        }
                        for (const d of result.disposables) {
                            try {
                                d.dispose();
                            } catch (ex) {
                                traceVerbose(`Dispose after deactivation: ${ex}`);
                            }
                        }
                        return;
                    }

                    ctx.lsClient = result.client;
                    serverDisposables = result.disposables;

                    if (nullFormatter && result.client) {
                        if (result.client.state === State.Running) {
                            nullFormatter.unregister();
                        } else {
                            // New client not yet Running — ensure placeholder is
                            // visible while the server finishes starting.  This
                            // covers the extension-driven restart path where the
                            // guard at the top skipped register() because the
                            // *old* client was still Running at that point.
                            nullFormatter.register();
                        }
                        serverDisposables.push(
                            result.client.onDidChangeState((e) => {
                                switch (e.newState) {
                                    case State.Running:
                                        nullFormatter.unregister();
                                        break;
                                    case State.Stopped:
                                    case State.Starting:
                                        nullFormatter.register();
                                        break;
                                }
                            }),
                        );
                    } else if (nullFormatter && !result.client) {
                        // No client available — ensure placeholder is visible
                        // so the extension remains in the formatter picker.
                        nullFormatter.register();
                    }
                }
            } catch (ex) {
                traceError(`Server restart failed: ${ex}`);
                // Ensure placeholder stays visible after a failure — but only
                // when there is no healthy running client (same guard as the
                // top of runServer to avoid the duplicate-formatter symptom).
                if (nullFormatter && (!ctx.lsClient || ctx.lsClient.state !== State.Running)) {
                    nullFormatter.register();
                }
            } finally {
                isRestarting = false;
            }
        },

        async initialize(subscriptions: vscode.Disposable[]): Promise<void> {
            try {
                const interpreter = getInterpreterFromSetting(serverId);
                if (interpreter === undefined || interpreter.length === 0) {
                    traceLog('Python extension loading');
                    // Opt-in via the `refreshExtensionOnPackagesChange` key on
                    // the extension's ToolConfig: when enabled, restart the
                    // server whenever the Python environment's package managers
                    // report a package install/uninstall.  The provider
                    // subscribes to the underlying event once and invokes this
                    // callback.
                    const onPackageChange = toolConfig.refreshExtensionOnPackagesChange
                        ? () => void safeRunServer(ctx, 'package change')
                        : undefined;
                    await pythonProvider.initializePython(subscriptions, onPackageChange);
                    traceLog('Python extension loaded');
                } else {
                    await ctx.runServer();
                }
            } catch (ex) {
                traceError(`Extension initialization failed: ${ex}`);
            }
        },

        dispose(): void {
            disposed = true;
            if (restartTimer) {
                clearTimeout(restartTimer);
                restartTimer = undefined;
            }
            for (const d of serverDisposables) {
                try {
                    d.dispose();
                } catch (ex) {
                    traceError(`Failed to dispose: ${ex}`);
                }
            }
            serverDisposables = [];
            nullFormatter?.dispose();
        },
    };

    return ctx;
}

// ---------------------------------------------------------------------------
// Shared subscriptions
// ---------------------------------------------------------------------------

/** Run server with error handling — fire-and-forget wrapper for event handlers. */
async function safeRunServer(toolContext: ToolExtensionContext, trigger: string): Promise<void> {
    try {
        traceLog(`Server restart triggered by: ${trigger}`);
        await toolContext.runServer();
    } catch (ex) {
        traceError(`Failed to restart server on ${trigger}: ${ex}`);
    }
}

/** Options for {@link registerCommonSubscriptions}. */
export interface RegisterSubscriptionsOptions {
    serverInfo: IServerInfo;
    outputChannel: vscode.LogOutputChannel;
    toolConfig: ToolConfig;
    toolContext: ToolExtensionContext;
    pythonProvider: PythonEnvironmentsProvider;
}

/**
 * Register all shared VS Code subscriptions for a tool extension.
 *
 * Pushes disposables directly into `context.subscriptions`.  Extensions
 * can register additional tool-specific subscriptions before or after
 * this call.
 */
export function registerCommonSubscriptions(
    context: vscode.ExtensionContext,
    options: RegisterSubscriptionsOptions,
): void {
    const { serverInfo, outputChannel, toolConfig, toolContext, pythonProvider } = options;
    const serverId = toolConfig.toolId;
    const serverName = serverInfo.name;

    // Log level change listeners
    const changeLogLevel = async (c: vscode.LogLevel, g: vscode.LogLevel) => {
        try {
            const level = getLSClientTraceLevel(c, g);
            await toolContext.lsClient?.setTrace(level);
        } catch (ex) {
            traceError(`Failed to set trace level: ${ex}`);
        }
    };

    context.subscriptions.push(
        outputChannel.onDidChangeLogLevel(async (e) => {
            await changeLogLevel(e, vscode.env.logLevel);
        }),
        vscode.env.onDidChangeLogLevel(async (e) => {
            await changeLogLevel(outputChannel.logLevel, e);
        }),
    );

    // Interpreter change
    context.subscriptions.push(
        pythonProvider.onDidChangeInterpreter(async () => {
            await safeRunServer(toolContext, 'interpreter change');
        }),
    );

    // Commands
    context.subscriptions.push(
        registerCommand(`${serverId}.showLogs`, async () => {
            outputChannel.show();
        }),
        registerCommand(`${serverId}.restart`, async () => {
            await safeRunServer(toolContext, 'restart command');
        }),
    );

    // Configuration change
    context.subscriptions.push(
        onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
            if (checkIfConfigurationChanged(e, serverId, toolConfig.trackedSettings)) {
                await safeRunServer(toolContext, 'config change');
            }
        }),
    );

    // Language status item
    context.subscriptions.push(registerLanguageStatusItem(serverId, serverName, `${serverId}.showLogs`));

    // Config file watchers
    context.subscriptions.push(
        ...createConfigFileWatchers(toolConfig.configFiles, toolConfig.toolDisplayName, async () => {
            await safeRunServer(toolContext, 'config file change');
        }),
    );

    // Log startup info
    traceLog(`Name: ${serverName}`);
    traceLog(`Module: ${toolConfig.toolModule}`);
    // Omit extraEnvVars from the log to avoid leaking sensitive values
    // (tokens, credentials) that may be passed via environment variables.
    const { extraEnvVars: _envVars, ...safeToolConfig } = toolConfig;
    traceVerbose(`Configuration: ${JSON.stringify(safeToolConfig)}`);
}

// ---------------------------------------------------------------------------
// Deactivation
// ---------------------------------------------------------------------------

/**
 * Stop the language client and clean up the tool context.
 *
 * Call from your extension's `deactivate()` function.
 */
export async function deactivateServer(toolContext?: ToolExtensionContext): Promise<void> {
    if (toolContext) {
        toolContext.dispose();
        if (toolContext.lsClient) {
            try {
                await toolContext.lsClient.stop();
            } catch (ex) {
                traceError(`Server: Stop failed: ${ex}`);
            }
        }
    }
}
