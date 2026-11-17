// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Tool configuration file watcher factory.
 *
 * Watches for changes to tool-specific config files (e.g. `.flake8`,
 * `pyproject.toml`, `setup.cfg`) and triggers a callback.  Each extension
 * provides its own list of file patterns via {@link ToolConfig.configFiles}.
 */

import { Disposable, workspace } from 'vscode';
import { traceError, traceLog } from './logging';

/**
 * Create file system watchers for tool configuration files.
 *
 * Returns one {@link Disposable} per pattern.  Each watcher fires
 * `onConfigChanged` when the matching file is created, changed, or
 * deleted.  A pending queue prevents concurrent handler invocations.
 *
 * @param configFiles - Glob-friendly file names to watch (e.g. `[".flake8", "setup.cfg"]`).
 * @param toolName - Display name for log messages (e.g. `"Flake8"`).
 * @param onConfigChanged - Async callback invoked when a config file changes.
 */
export function createConfigFileWatchers(
    configFiles: string[],
    toolName: string,
    onConfigChanged: () => Promise<void>,
): Disposable[] {
    const watchers: Disposable[] = [];
    try {
        for (const pattern of configFiles) {
            const watcher = workspace.createFileSystemWatcher(`**/${pattern}`);
            const registrations: Disposable[] = [watcher];
            let disposed = false;
            let pending: Promise<void> | undefined;

            const handleEvent = (event: string) => {
                if (disposed) {
                    return;
                }
                traceLog(`${toolName} config file ${event}: ${pattern}`);
                const run = () => onConfigChanged().catch((e) => traceError(`Config file ${event} handler failed`, e));

                const nextPending = (pending ? pending.then(run, run) : run()).finally(() => {
                    if (pending === nextPending) {
                        pending = undefined;
                    }
                });

                pending = nextPending;
            };

            watchers.push({
                dispose(): void {
                    disposed = true;
                    pending = undefined;
                    for (const disposable of registrations.splice(0).reverse()) {
                        try {
                            disposable.dispose();
                        } catch (error) {
                            traceError('Config watcher cleanup failed', error);
                        }
                    }
                },
            });
            registrations.push(watcher.onDidChange(() => handleEvent('changed')));
            registrations.push(watcher.onDidCreate(() => handleEvent('created')));
            registrations.push(watcher.onDidDelete(() => handleEvent('deleted')));
        }
        return watchers;
    } catch (error) {
        // A caller cannot own watchers that this factory never returned.
        for (const watcher of watchers.reverse()) {
            watcher.dispose();
        }
        throw error;
    }
}
