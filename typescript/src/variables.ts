// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * VS Code variable substitution utilities.
 *
 * Handles `${workspaceFolder}` and other VS Code-style variable
 * replacements in user-configurable string settings.
 */

import * as path from 'path';
import { WorkspaceFolder } from 'vscode';

/**
 * Resolves `${workspaceFolder}` placeholders in a string.
 */
export function resolveWorkspaceFolder(value: string, workspace: WorkspaceFolder): string {
    return value.replace(/\$\{workspaceFolder\}/g, workspace.uri.fsPath);
}

/**
 * Expands a leading `~` to the user's home directory.
 */
export function expandTilde(value: string): string {
    const home = process.env.HOME || process.env.USERPROFILE;
    if (!home) {
        return value;
    }
    if (value === '~') {
        return home;
    }
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(home, value.slice(2));
    }
    return value;
}

/**
 * Resolves a path setting value by substituting variables, expanding tilde,
 * and making relative paths absolute against the workspace root.
 */
export function resolvePathSetting(value: string, workspace: WorkspaceFolder): string {
    let resolved = resolveWorkspaceFolder(value, workspace);
    resolved = expandTilde(resolved);
    if (!path.isAbsolute(resolved)) {
        resolved = path.join(workspace.uri.fsPath, resolved);
    }
    return resolved;
}
