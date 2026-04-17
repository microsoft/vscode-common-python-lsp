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
    return configFiles.map((pattern) => {
        const watcher = workspace.createFileSystemWatcher(`**/${pattern}`);
        let disposed = false;
        let pending: Promise<void> | undefined;

        const handleEvent = (event: string) => {
            if (disposed) {
                return;
            }
            traceLog(`${toolName} config file ${event}: ${pattern}`);
            pending = onConfigChanged()
                .catch((e) => traceError(`Config file ${event} handler failed`, e))
                .finally(() => {
                    pending = undefined;
                });
        };

        const changeDisposable = watcher.onDidChange(() => handleEvent('changed'));
        const createDisposable = watcher.onDidCreate(() => handleEvent('created'));
        const deleteDisposable = watcher.onDidDelete(() => handleEvent('deleted'));

        return {
            dispose(): void {
                disposed = true;
                pending = undefined;
                changeDisposable.dispose();
                createDisposable.dispose();
                deleteDisposable.dispose();
                watcher.dispose();
            },
        };
    });
}
