// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as vscode from 'vscode';
import { createToolContext, deactivateServer, registerCommonSubscriptions, ToolExtensionContext } from './activation';
import { registerLogger } from './logging';
import { PythonEnvironmentsProvider } from './python';
import { IServerInfo, ToolConfig } from './types';
import { createOutputChannel } from './vscodeapi';

/** Explicit tool metadata and policy for {@link activateToolExtension}. */
export interface ActivateToolExtensionOptions {
    serverInfo: IServerInfo;
    /** Accepts legacy ToolConfig and structurally compatible ToolDefinition values. */
    toolConfig: ToolConfig;
}

/** The facade's lifetime handle, not a client-ready notification. */
export interface ToolExtensionRuntime {
    /**
     * Idempotently cancel deferred initialization and dispose facade-owned resources.
     *
     * Stops the client via deactivateServer and waits for an already-started
     * initialize() to settle, disposing late subscriptions too. This does not
     * drain every in-flight restart or delayed retry in the legacy lifecycle.
     * Cleanup failures are logged rather than rejected.
     */
    deactivate(): Promise<void>;
}

/**
 * Compose the shared runtime without changing the existing tool lifecycle.
 *
 * Common listeners and a formatter placeholder (when enabled) are installed
 * synchronously. Initialization is deferred with setImmediate: returning this
 * handle does not mean Python is resolved or the language client is Running.
 *
 * Owns its output channel, logger, Python provider, tool context and subscriptions;
 * the caller's other subscriptions are untouched. Context disposal initiates the
 * same cleanup as deactivate(); explicitly await deactivate() to observe completion.
 * The existing module-global logger/status still preclude independent tool instances.
 */
export function activateToolExtension(
    context: vscode.ExtensionContext,
    options: ActivateToolExtensionOptions,
): ToolExtensionRuntime {
    let outputChannel: vscode.LogOutputChannel | undefined;
    let logger: vscode.Disposable | undefined;
    let toolContext: ToolExtensionContext | undefined;
    let scheduled: NodeJS.Immediate | undefined;
    let initialization: Promise<void> = Promise.resolve();
    let closed = false;
    let finishShutdown!: () => void;
    const shutdown = new Promise<void>((resolve) => {
        finishShutdown = resolve;
    });
    const subscriptions: vscode.Disposable[] = [];
    const pendingDisposals: Promise<void>[] = [];

    function report(message: string, error: unknown): void {
        try {
            outputChannel?.error(`${message}: ${error}`);
        } catch {
            // A broken output channel must not turn cleanup into an unhandled rejection.
        }
    }

    async function dispose(disposable: vscode.Disposable | undefined): Promise<void> {
        try {
            await disposable?.dispose();
        } catch (error) {
            report('Tool extension cleanup failed', error);
        }
    }

    // Legacy initialization appends to this array after awaits. Once closed,
    // dispose additions immediately instead of retaining unowned subscriptions.
    subscriptions.push = (...items) => {
        if (closed) {
            for (const item of items) {
                pendingDisposals.push(dispose(item));
            }
        } else {
            Array.prototype.push.apply(subscriptions, items);
        }
        return subscriptions.length;
    };

    async function teardown(): Promise<void> {
        // Dispose the context first so events/late initialization cannot revive it.
        const stopping = deactivateServer(toolContext).catch((error) =>
            report('Tool extension shutdown failed', error),
        );
        for (const disposable of subscriptions.splice(0).reverse()) {
            pendingDisposals.push(dispose(disposable));
        }
        await Promise.all([stopping, initialization]);
        while (pendingDisposals.length > 0) {
            await Promise.all(pendingDisposals.splice(0));
        }
        // Keep logging available until initialization and late cleanup have settled.
        await dispose(logger);
        await dispose(outputChannel);
    }

    function deactivate(): Promise<void> {
        if (!closed) {
            closed = true;
            if (scheduled) {
                clearImmediate(scheduled);
                scheduled = undefined;
            }
            void teardown().then(finishShutdown, (error) => {
                report('Tool extension shutdown failed', error);
                finishShutdown();
            });
        }
        return shutdown;
    }

    try {
        const { serverInfo, toolConfig } = options;
        outputChannel = createOutputChannel(serverInfo.name);
        logger = registerLogger(outputChannel);
        const pythonProvider = new PythonEnvironmentsProvider(toolConfig);
        subscriptions.push(pythonProvider);
        toolContext = createToolContext({
            serverInfo,
            outputChannel,
            toolConfig,
            pythonProvider,
        });
        registerCommonSubscriptions(
            { subscriptions },
            { serverInfo, outputChannel, toolConfig, toolContext, pythonProvider },
        );
        context.subscriptions.push({ dispose: () => void deactivate() });
        scheduled = setImmediate(() => {
            scheduled = undefined;
            initialization = Promise.resolve()
                .then(() => {
                    if (!closed) {
                        return toolContext?.initialize(subscriptions);
                    }
                    return undefined;
                })
                .catch((error) => report('Tool extension initialization failed', error));
        });
        return { deactivate };
    } catch (error) {
        report('Tool extension activation failed', error);
        void deactivate();
        throw error;
    }
}
