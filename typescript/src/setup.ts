// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as fs from 'fs-extra';
import { IServerInfo } from './types';

/**
 * Resolved paths for an extension's bundled Python scripts.
 *
 * Returned by {@link resolveExtensionPaths} so that extensions
 * do not need to duplicate `path.join` boilerplate.
 */
export interface ExtensionPaths {
    /** The extension root directory (same value passed in). */
    extensionRoot: string;
    /** Path to `bundled/` directory containing Python scripts and libs. */
    bundledScripts: string;
    /** Path to the main `lsp_server.py` script. */
    serverScript: string;
    /** Path to the debug variant `_debug_server.py`. */
    debugServerScript: string;
}

/**
 * Computes the standard bundled script paths from an extension root directory.
 *
 * All VS Code Python tool extensions follow the same layout:
 * ```
 * <extensionRoot>/bundled/tool/lsp_server.py
 * <extensionRoot>/bundled/tool/_debug_server.py
 * ```
 *
 * Use this instead of manually computing the paths in each extension's
 * `constants.ts`.
 */
export function resolveExtensionPaths(extensionRootDir: string): ExtensionPaths {
    const bundledScripts = path.join(extensionRootDir, 'bundled');
    return {
        extensionRoot: extensionRootDir,
        bundledScripts,
        serverScript: path.join(bundledScripts, 'tool', 'lsp_server.py'),
        debugServerScript: path.join(bundledScripts, 'tool', '_debug_server.py'),
    };
}

/**
 * Resolves the extension root directory from a `__dirname` value.
 *
 * Handles both development layout (`src/common/constants.ts` — 2 levels up)
 * and production layout (`dist/extension.js` — 1 level up) by checking
 * whether the immediate folder name is `'common'`.
 *
 * Replaces the standard boilerplate found in every extension's `constants.ts`:
 * ```ts
 * const folderName = path.basename(__dirname);
 * export const EXTENSION_ROOT_DIR =
 *     folderName === 'common' ? path.dirname(path.dirname(__dirname)) : path.dirname(__dirname);
 * ```
 */
export function resolveExtensionRoot(dirname: string): string {
    const folderName = path.basename(dirname);
    return folderName === 'common' ? path.dirname(path.dirname(dirname)) : path.dirname(dirname);
}

export function loadServerDefaults(extensionRootDir: string): IServerInfo {
    const packageJson = path.join(extensionRootDir, 'package.json');

    let content: string;
    try {
        content = fs.readFileSync(packageJson).toString();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read "${packageJson}": ${message}`);
    }

    let config: Record<string, unknown>;
    try {
        config = JSON.parse(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in "${packageJson}": ${message}`);
    }

    const serverInfo = config.serverInfo;
    if (!serverInfo || typeof serverInfo !== 'object') {
        throw new Error(`Missing or invalid "serverInfo" in "${packageJson}".`);
    }

    return serverInfo as IServerInfo;
}
