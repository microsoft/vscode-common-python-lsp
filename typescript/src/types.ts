// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared type definitions for VS Code Python tool extensions.
 */

/** Server identity metadata loaded from `package.json`. */
export interface IServerInfo {
    name: string;
    module: string;
}

/** Base settings resolved per workspace by the settings module. */
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

/** Initialization options sent to the Python LSP server. */
export interface IInitOptions {
    settings: IBaseSettings[];
    globalSettings: IBaseSettings;
}

/** Tool-specific configuration supplied by each extension. */
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

    /**
     * Set to `true` for tools that provide LSP formatting (textDocument/formatting,
     * rangeFormatting, rangesFormatting).
     *
     * When enabled, the common activation pattern will:
     *   - register a placeholder DocumentFormattingEditProvider at activation time
     *     (so VS Code lists the extension as a formatter *before* the LSP has
     *     finished starting),
     *   - dispose it automatically when the language client transitions to
     *     `Running` (so VS Code does not see two providers for the same selector
     *     and list the extension twice in the formatter picker),
     *   - re-register it if the client transitions back to `Stopped` / `Starting`
     *     during a restart, then dispose it again on the next `Running`.
     *
     * Defaults to `false`. Linter-only tools (pylint, flake8, mypy, …) should
     * leave this unset.
     */
    isFormatter?: boolean;
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
