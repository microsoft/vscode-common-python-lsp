// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * VS Code variable substitution utilities.
 *
 * Resolves VS Code-style variable placeholders (`${workspaceFolder}`, `${userHome}`,
 * `${cwd}`, `${workspaceFolder:name}`, `${env:VAR}`, `${interpreter}`, `~/`)
 * in user-configurable string settings.
 */

import * as os from 'os';
import * as path from 'path';
import { WorkspaceFolder } from 'vscode';
import { getWorkspaceFolders } from './vscodeapi';

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
    substitutions.set('~/', `${home}/`);
    substitutions.set('~\\', `${home}\\`);

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
            s = s.replace(key, value);
        }
        return s;
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
