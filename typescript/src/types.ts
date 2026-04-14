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

    // Settings
    settingsDefaults: Record<string, unknown>;
    trackedSettings: string[];

    // Environment
    extraEnvVars?: Record<string, string>;
}
