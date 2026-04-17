// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Python interpreter resolution abstraction.
 *
 * Provides a unified interface for resolving Python interpreters via the
 * newer `@vscode/python-environments` API (preferred) or the legacy
 * `@vscode/python-extension` API (fallback).  All five extension repos
 * duplicated ~220 lines of identical code for this — now centralised here.
 *
 * The two external APIs are wrapped behind {@link IPythonApi} so that
 * {@link PythonEnvironmentsProvider} never branches on API type.
 */

import { PythonEnvironmentApi, PythonEnvironments } from '@vscode/python-environments';
import { PythonExtension } from '@vscode/python-extension';
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

/**
 * Unified Python extension API.
 *
 * Both `@vscode/python-environments` and the legacy `@vscode/python-extension`
 * are adapted to this shape by {@link wrapEnvironmentsApi} /
 * {@link wrapLegacyApi}.  Consumers never need to know which API is in use.
 */
export interface IPythonApi {
    /** Which underlying extension provides this API. */
    readonly extension: 'ms-python.python-environments' | 'ms-python.python';

    /** Resolve the active environment for a workspace/resource. */
    getEnvironment(resource?: Uri): Promise<IResolvedPythonEnvironment | undefined>;

    /** Resolve full environment details for a given interpreter path. */
    resolveEnvironment(interpreterPath: string): Promise<IResolvedPythonEnvironment | undefined>;

    /** Subscribe to interpreter/environment changes. */
    onDidChangeEnvironment(handler: () => void): Disposable;

    /**
     * Get the debugger package path.
     *
     * Only available via the legacy `ms-python.python` extension.
     * Returns `undefined` when provided by `ms-python.python-environments`.
     */
    getDebuggerPath(): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// API adapters
// ---------------------------------------------------------------------------

/** Wrap the newer `@vscode/python-environments` API. */
function wrapEnvironmentsApi(api: PythonEnvironmentApi): IPythonApi {
    return {
        extension: 'ms-python.python-environments',

        async getEnvironment(resource?: Uri) {
            const environment = await api.getEnvironment(resource);
            if (!environment) {
                return undefined;
            }
            const runConfig = environment.execInfo?.activatedRun ?? environment.execInfo?.run;
            const executable = runConfig?.executable;
            if (!executable) {
                traceError('No executable found for selected Python environment.');
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
        },

        async resolveEnvironment(interpreterPath: string) {
            const environment = await api.resolveEnvironment(Uri.file(interpreterPath));
            if (!environment) {
                return undefined;
            }
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
        },

        onDidChangeEnvironment(handler: () => void) {
            return api.onDidChangeEnvironment(handler);
        },

        async getDebuggerPath() {
            return undefined;
        },
    };
}

/** Wrap the legacy `@vscode/python-extension` API. */
function wrapLegacyApi(api: PythonExtension): IPythonApi {
    return {
        extension: 'ms-python.python',

        async getEnvironment(resource?: Uri) {
            const environment = await api.environments.resolveEnvironment(
                api.environments.getActiveEnvironmentPath(resource),
            );
            if (!environment) {
                return undefined;
            }
            const fsPath = environment.executable?.uri?.fsPath;
            if (!fsPath) {
                return undefined;
            }
            const version = environment.version;
            return {
                executablePath: fsPath,
                version: version
                    ? { major: version.major, minor: version.minor, micro: version.micro }
                    : undefined,
            };
        },

        async resolveEnvironment(interpreterPath: string) {
            const environment = await api.environments.resolveEnvironment(interpreterPath);
            if (!environment) {
                return undefined;
            }
            const fsPath = environment.executable?.uri?.fsPath;
            if (!fsPath) {
                return undefined;
            }
            const version = environment.version;
            return {
                executablePath: fsPath,
                version: version
                    ? { major: version.major, minor: version.minor, micro: version.micro }
                    : undefined,
            };
        },

        onDidChangeEnvironment(handler: () => void) {
            return api.environments.onDidChangeActiveEnvironmentPath(handler);
        },

        async getDebuggerPath() {
            return api.debug.getDebuggerPackagePath();
        },
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

    private _api: IPythonApi | undefined;
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
    // API acquisition (cached, envs preferred → legacy fallback)
    // -----------------------------------------------------------------

    private async getApi(): Promise<IPythonApi | undefined> {
        if (this._api) {
            return this._api;
        }
        try {
            const envsApi = await PythonEnvironments.api();
            this._api = wrapEnvironmentsApi(envsApi);
            return this._api;
        } catch {
            // envs extension not available — try legacy
        }
        try {
            const legacyApi = await PythonExtension.api();
            this._api = wrapLegacyApi(legacyApi);
            return this._api;
        } catch {
            // legacy extension not available either
        }
        return undefined;
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
     * Set up event listeners for Python interpreter changes and resolve
     * the initial interpreter.
     */
    async initializePython(disposables: Disposable[]): Promise<void> {
        try {
            const api = await this.getApi();
            if (!api) {
                return;
            }

            disposables.push(
                api.onDidChangeEnvironment(async () => {
                    await this.refreshServerPython();
                }),
            );

            traceLog(`Waiting for interpreter from ${api.extension} extension.`);
            await this.refreshServerPython();
        } catch (error) {
            traceError('Error initializing Python: ', error);
        }
    }

    /**
     * Resolve the Python interpreter for a workspace/resource.
     */
    async getInterpreterDetails(resource?: Uri): Promise<IInterpreterDetails> {
        const api = await this.getApi();
        if (!api) {
            return { path: undefined, resource };
        }
        try {
            const resolved = await api.getEnvironment(resource);
            if (resolved && this.checkVersion(resolved)) {
                return { path: [resolved.executablePath, ...(resolved.args ?? [])], resource };
            }
        } catch (error) {
            traceError('Error getting interpreter details: ', error);
        }
        return { path: undefined, resource };
    }

    /**
     * Resolve full environment details for a given interpreter path.
     */
    async resolveInterpreter(interpreter: string[]): Promise<IResolvedPythonEnvironment | undefined> {
        if (!interpreter.length) {
            return undefined;
        }
        const api = await this.getApi();
        if (!api) {
            return undefined;
        }
        try {
            return await api.resolveEnvironment(interpreter[0]);
        } catch (error) {
            traceError('Error resolving interpreter: ', error);
            return undefined;
        }
    }

    /**
     * Check whether a resolved environment meets the minimum Python
     * version requirement from the tool configuration.
     */
    checkVersion(resolved: IResolvedPythonEnvironment | undefined): boolean {
        const version = resolved?.version;
        if (version && (version.major > this._minMajor || (version.major === this._minMajor && version.minor >= this._minMinor))) {
            return true;
        }
        traceError(`Python version ${version?.major}.${version?.minor} is not supported.`);
        traceError(`Selected python path: ${resolved?.executablePath}`);
        traceError(`Supported versions are ${this._versionLabel} and above.`);
        return false;
    }

    /**
     * Get the debugger package path.
     *
     * Only available via the legacy `ms-python.python` extension;
     * returns `undefined` when using `ms-python.python-environments`.
     */
    async getDebuggerPath(): Promise<string | undefined> {
        const api = await this.getApi();
        return api?.getDebuggerPath();
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
