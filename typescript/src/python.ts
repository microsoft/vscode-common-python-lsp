// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Python interpreter resolution abstraction.
 *
 * Provides a unified interface for resolving Python interpreters via the
 * newer `@vscode/python-environments` API (preferred) or the legacy
 * `@vscode/python-extension` API (fallback).  All five extension repos
 * duplicated ~220 lines of identical code for this — now centralised here.
 */

import { PythonEnvironment, PythonEnvironmentApi, PythonEnvironments } from '@vscode/python-environments';
import { PythonExtension, ResolvedEnvironment } from '@vscode/python-extension';
import * as semver from 'semver';
import { Disposable, Event, EventEmitter, Uri } from 'vscode';
import { traceError, traceLog } from './logging';
import { IResolvedPythonEnvironment, ToolConfig } from './types';
import { getProjectRoot } from './utilities';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IInterpreterDetails {
    path?: string[];
    resource?: Uri;
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Extract an {@link IResolvedPythonEnvironment} from the newer
 * `@vscode/python-environments` {@link PythonEnvironment}.
 */
function fromPythonEnvironment(environment: PythonEnvironment): IResolvedPythonEnvironment | undefined {
    const runConfig = environment.execInfo?.activatedRun ?? environment.execInfo?.run;
    const executable = runConfig?.executable;
    if (!executable) {
        return undefined;
    }
    const coerced = semver.coerce(environment.version);
    return {
        executablePath: executable,
        version: coerced
            ? { major: coerced.major, minor: coerced.minor, micro: coerced.patch }
            : undefined,
        args: runConfig?.args,
    };
}

/**
 * Extract an {@link IResolvedPythonEnvironment} from the legacy
 * `@vscode/python-extension` {@link ResolvedEnvironment}.
 */
function fromLegacyResolved(resolved: ResolvedEnvironment): IResolvedPythonEnvironment | undefined {
    const fsPath = resolved.executable?.uri?.fsPath;
    if (!fsPath) {
        return undefined;
    }
    const version = resolved.version;
    return {
        executablePath: fsPath,
        version: version
            ? { major: version.major, minor: version.minor, micro: version.micro }
            : undefined,
    };
}

// ---------------------------------------------------------------------------
// PythonEnvironmentsProvider
// ---------------------------------------------------------------------------

/**
 * Abstracts Python interpreter resolution across both the legacy
 * `ms-python.python` and newer `ms-python.python-environments` APIs.
 *
 * Create one instance per extension, passing the extension's
 * {@link ToolConfig} for version checking.
 */
export class PythonEnvironmentsProvider {
    private readonly _onDidChangeInterpreter = new EventEmitter<void>();
    /** Fires when the active Python interpreter changes. */
    public readonly onDidChangeInterpreter: Event<void> = this._onDidChangeInterpreter.event;

    private _legacyApi: PythonExtension | undefined;
    private _envsApi: PythonEnvironmentApi | undefined;
    private _serverPython: string[] | undefined;

    private readonly _minMajor: number;
    private readonly _minMinor: number;
    private readonly _versionLabel: string;

    constructor(config: ToolConfig) {
        this._minMajor = config.minimumPythonVersion.major;
        this._minMinor = config.minimumPythonVersion.minor;
        this._versionLabel = `${this._minMajor}.${this._minMinor}`;
    }

    // -----------------------------------------------------------------
    // API acquisition (cached)
    // -----------------------------------------------------------------

    private async getLegacyApi(): Promise<PythonExtension | undefined> {
        if (this._legacyApi) {
            return this._legacyApi;
        }
        try {
            this._legacyApi = await PythonExtension.api();
        } catch {
            return undefined;
        }
        return this._legacyApi;
    }

    private async getEnvsApi(): Promise<PythonEnvironmentApi | undefined> {
        if (this._envsApi) {
            return this._envsApi;
        }
        try {
            this._envsApi = await PythonEnvironments.api();
        } catch {
            return undefined;
        }
        return this._envsApi;
    }

    // -----------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------

    private checkAndFireEvent(interpreter: string[] | undefined): void {
        if (interpreter === undefined) {
            if (this._serverPython) {
                this._serverPython = undefined;
                this._onDidChangeInterpreter.fire();
            }
            return;
        }

        if (!this._serverPython || !sameInterpreter(this._serverPython, interpreter)) {
            this._serverPython = interpreter;
            this._onDidChangeInterpreter.fire();
        }
    }

    private async refreshServerPython(): Promise<void> {
        const projectRoot = await getProjectRoot();
        const interpreter = await this.getInterpreterDetails(projectRoot?.uri);
        this.checkAndFireEvent(interpreter.path);
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Set up event listeners for Python interpreter changes.
     *
     * Prefers the Python Environments extension; falls back to the
     * legacy `ms-python.python` extension API.
     */
    async initializePython(disposables: Disposable[]): Promise<void> {
        try {
            const envsApi = await this.getEnvsApi();

            if (envsApi) {
                disposables.push(
                    envsApi.onDidChangeEnvironment(async () => {
                        await this.refreshServerPython();
                    }),
                );

                traceLog('Waiting for interpreter from Python environments extension.');
                await this.refreshServerPython();
                return;
            }

            const api = await this.getLegacyApi();

            if (api) {
                disposables.push(
                    api.environments.onDidChangeActiveEnvironmentPath(async () => {
                        await this.refreshServerPython();
                    }),
                );

                traceLog('Waiting for interpreter from Python extension.');
                await this.refreshServerPython();
            }
        } catch (error) {
            traceError('Error initializing Python: ', error);
        }
    }

    /**
     * Resolve the Python interpreter for a workspace/resource.
     *
     * Tries the Python Environments API first, then falls back to
     * the legacy extension API.
     */
    async getInterpreterDetails(resource?: Uri): Promise<IInterpreterDetails> {
        const envsApi = await this.getEnvsApi();
        if (envsApi) {
            try {
                const environment = await envsApi.getEnvironment(resource);
                if (environment) {
                    const coerced = semver.coerce(environment.version);
                    const runConfig = environment.execInfo?.activatedRun ?? environment.execInfo?.run;
                    const executable = runConfig?.executable;
                    const args = runConfig?.args ?? [];
                    if (coerced && coerced.major === this._minMajor && coerced.minor >= this._minMinor) {
                        if (executable) {
                            return { path: [executable, ...args], resource };
                        }
                        traceError('No executable found for selected Python environment.');
                        return { path: undefined, resource };
                    }
                    traceError(`Python version ${environment.version} is not supported.`);
                    traceError(`Selected python path: ${runConfig?.executable}`);
                    traceError(`Supported versions are ${this._versionLabel} and above.`);
                    return { path: undefined, resource };
                }
            } catch (error) {
                traceError('Error getting interpreter from Python environments extension: ', error);
            }
        }

        const api = await this.getLegacyApi();
        try {
            const environment = await api?.environments.resolveEnvironment(
                api?.environments.getActiveEnvironmentPath(resource),
            );
            if (environment) {
                const resolved = fromLegacyResolved(environment);
                if (resolved && this.checkVersion(resolved)) {
                    return { path: [resolved.executablePath], resource };
                }
            }
        } catch (error) {
            traceError('Error resolving Python environment via legacy API: ', error);
        }
        return { path: undefined, resource };
    }

    /**
     * Resolve full environment details for a given interpreter path.
     */
    async resolveInterpreter(interpreter: string[]): Promise<IResolvedPythonEnvironment | undefined> {
        const envsApi = await this.getEnvsApi();
        if (envsApi) {
            const environment = await envsApi.resolveEnvironment(Uri.file(interpreter[0]));
            if (!environment) {
                return undefined;
            }
            return fromPythonEnvironment(environment);
        }
        const api = await this.getLegacyApi();
        const resolved = await api?.environments.resolveEnvironment(interpreter[0]);
        return resolved ? fromLegacyResolved(resolved) : undefined;
    }

    /**
     * Check whether a resolved environment meets the minimum Python
     * version requirement from the tool configuration.
     */
    checkVersion(resolved: IResolvedPythonEnvironment | undefined): boolean {
        const version = resolved?.version;
        if (version?.major === this._minMajor && version?.minor >= this._minMinor) {
            return true;
        }
        traceError(`Python version ${version?.major}.${version?.minor} is not supported.`);
        traceError(`Selected python path: ${resolved?.executablePath}`);
        traceError(`Supported versions are ${this._versionLabel} and above.`);
        return false;
    }

    /**
     * Get the debugger package path from the legacy Python extension.
     *
     * The Python Environments extension does not yet expose a debug API.
     */
    async getDebuggerPath(): Promise<string | undefined> {
        const api = await this.getLegacyApi();
        return api?.debug.getDebuggerPackagePath();
    }

    /** Dispose internal resources. */
    dispose(): void {
        this._onDidChangeInterpreter.dispose();
    }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

/** Compare two interpreter path arrays for equality. */
function sameInterpreter(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}
