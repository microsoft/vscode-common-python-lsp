// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared type definitions for VS Code Python tool extensions.
 */

export interface IServerInfo {
    name: string;
    module: string;
}

export interface IBaseSettings {
    cwd: string;
    workspace: string;
    args: string[];
    path: string[];
    interpreter: string[];
    importStrategy: string;
    showNotifications: string;
    extraPaths?: string[];
    [key: string]: unknown;
}

export interface IInitOptions {
    settings: IBaseSettings[];
    globalSettings: IBaseSettings;
}

export interface ToolConfig {
    // Identity
    toolId: string;
    toolDisplayName: string;
    toolModule: string;

    // Python
    minimumPythonVersion: { major: number; minor: number };

    // Server
    configFiles: string[];
    serverScript: string;
    debugServerScript?: string;
    restartDelay?: number;
    pythonUtf8?: boolean;

    // Settings
    settingsDefaults: Record<string, unknown>;
    trackedSettings: string[];

    // Environment
    extraEnvVars?: Record<string, string>;
}

/**
 * Canonical resolved Python environment — API-agnostic.
 *
 * Carries only the fields actually consumed by the shared package and
 * extension code.  Both the newer `@vscode/python-environments`
 * (`PythonEnvironment`) and legacy `@vscode/python-extension`
 * (`ResolvedEnvironment`) are converted into this shape internally.
 *
 * **Breaking change (PR #10):** replaces the previous
 * `ResolvedEnvironment` re-export from `@vscode/python-extension`.
 * Migrate `.executable.uri.fsPath` → `.executablePath`.
 */
export interface IResolvedPythonEnvironment {
    /** Absolute path to the Python executable. */
    executablePath: string;
    /** Parsed version, if available. */
    version?: { major: number; minor: number; micro: number };
    /** Additional CLI arguments (from new API's `execInfo.args`). */
    args?: string[];
}
