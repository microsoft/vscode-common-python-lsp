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
import { getWorkspaceFolders } from './vscodeapi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IInterpreterDetails {
    path?: string[];
    resource?: Uri;
}

export interface IPythonProject {
    name: string;
    uri: Uri;
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

    /** Return the Python projects known to the environments extension. */
    getPythonProjects?(): Promise<readonly IPythonProject[]>;

    /** Subscribe to Python project additions and removals. */
    onDidChangePythonProjects?(handler: () => void): Disposable;

    /**
     * Subscribe to package changes detected by the environment's package
     * managers.
     *
    * Only available from newer versions of
    * `ms-python.python-environments`.
     */
    onDidChangePackages?(handler: () => void): Disposable;

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
                version: coerced ? { major: coerced.major, minor: coerced.minor, micro: coerced.patch } : undefined,
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
                version: coerced ? { major: coerced.major, minor: coerced.minor, micro: coerced.patch } : undefined,
                args: runConfig?.args,
            };
        },

        onDidChangeEnvironment(handler: () => void) {
            return api.onDidChangeEnvironment(handler);
        },

        async getPythonProjects() {
            if (typeof api.getPythonProjects !== 'function') {
                return [];
            }
            return api.getPythonProjects().map((project) => ({ name: project.name, uri: project.uri }));
        },

        onDidChangePythonProjects(handler: () => void) {
            return typeof api.onDidChangePythonProjects === 'function'
                ? api.onDidChangePythonProjects(handler)
                : { dispose: () => undefined };
        },

        onDidChangePackages(handler: () => void) {
            return api.onDidChangePackages(handler);
        },

        async getDebuggerPath() {
            // TODO: Not yet supported by the environments extension. Implement when it is.
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
                version: version ? { major: version.major, minor: version.minor, micro: version.micro } : undefined,
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
                version: version ? { major: version.major, minor: version.minor, micro: version.micro } : undefined,
            };
        },

        onDidChangeEnvironment(handler: () => void) {
            return api.environments.onDidChangeActiveEnvironmentPath(handler);
        },

        async getPythonProjects() {
            return getWorkspaceFolders().map((workspace) => ({
                name: workspace.name,
                uri: workspace.uri,
            }));
        },

        onDidChangePythonProjects() {
            return { dispose: () => undefined };
        },

        onDidChangePackages() {
            // The legacy ms-python.python API does not expose package change
            // events, so there is nothing to subscribe to.
            return { dispose: () => undefined };
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
    private _apiResolved = false;
    private _serverPythons: Map<string, string[] | undefined> | undefined;

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

    private async getApi(useCache: boolean = true): Promise<IPythonApi | undefined> {
        if (useCache && this._apiResolved) {
            return this._api;
        }
        try {
            const envsApi = await PythonEnvironments.api();
            this._api = wrapEnvironmentsApi(envsApi);
            this._apiResolved = true;
            return this._api;
        } catch {
            traceLog('Python environments extension not available — trying legacy.');
        }
        try {
            const legacyApi = await PythonExtension.api();
            this._api = wrapLegacyApi(legacyApi);
            this._apiResolved = true;
            return this._api;
        } catch {
            traceLog('Legacy Python extension not available.');
        }
        this._apiResolved = true;
        return undefined;
    }

    // -----------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------

    private checkAndFireEvent(interpreters: Map<string, string[] | undefined>, fireInitial: boolean): void {
        const changed = !this._serverPythons
            ? fireInitial && Array.from(interpreters.values()).some((interpreter) => interpreter !== undefined)
            : !sameInterpreters(this._serverPythons, interpreters);
        this._serverPythons = interpreters;
        if (changed) {
            this._onDidChangeInterpreter.fire();
        }
    }

    private async refreshServerPython(
        getResources?: () => Promise<readonly Uri[]>,
        fireInitial: boolean = true,
    ): Promise<void> {
        const resources = getResources ? await getResources() : [(await getProjectRoot()).uri];
        const details = await Promise.all(resources.map((resource) => this.getInterpreterDetails(resource)));
        const interpreters = new Map<string, string[] | undefined>();
        for (const detail of details) {
            if (detail.resource) {
                interpreters.set(detail.resource.toString(), detail.path);
            }
        }
        this.checkAndFireEvent(interpreters, fireInitial);
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------

    /**
     * Set up event listeners for Python interpreter changes and resolve
     * the initial interpreter.
     *
     * @param disposables - Collected disposables for the registered listeners.
     */
    async initializePython(
        disposables: Disposable[],
        getResources?: () => Promise<readonly Uri[]>,
        fireInitial: boolean = true,
    ): Promise<void> {
        try {
            const api = await this.getApi();
            if (!api) {
                return;
            }

            disposables.push(
                api.onDidChangeEnvironment(async () => {
                    try {
                        await this.refreshServerPython(getResources);
                    } catch (error) {
                        traceError('Error refreshing Python interpreter: ', error);
                    }
                }),
            );
            if (typeof api.onDidChangePythonProjects === 'function') {
                disposables.push(
                    api.onDidChangePythonProjects(async () => {
                        try {
                            await this.refreshServerPython(getResources);
                        } catch (error) {
                            traceError('Error refreshing Python projects: ', error);
                        }
                    }),
                );
            }

            traceLog(`Waiting for interpreter from ${api.extension} extension.`);
            await this.refreshServerPython(getResources, fireInitial);
        } catch (error) {
            traceError('Error initializing Python: ', error);
        }
    }

    /** Return the projects known to the active Python environments API. */
    async getPythonProjects(): Promise<readonly IPythonProject[]> {
        const api = await this.getApi();
        if (!api) {
            return [];
        }
        try {
            return typeof api.getPythonProjects === 'function' ? await api.getPythonProjects() : [];
        } catch (error) {
            traceError('Error getting Python projects: ', error);
            return [];
        }
    }

    /**
     * Subscribe to package changes reported by the active environment's package
     * managers and invoke {@link handler} on each one.
     *
     * This is intentionally decoupled from {@link initializePython} so it can be
     * wired regardless of how the interpreter was selected (resolved by the
     * Python extension *or* pinned via the `<serverId>.interpreter` setting).
     *
     * Subscription failures are non-fatal: if no API is available, the runtime
     * does not expose `onDidChangePackages` (e.g. the legacy `ms-python.python`
     * extension or a version-skewed runtime), or subscribing throws, this
     * resolves to `undefined` and logs rather than propagating — a refresh
     * feature must never block or break activation.
     *
     * @returns A {@link Disposable} for the subscription, or `undefined` when no
     *   package-change event is available.
     */
    async subscribeToPackageChanges(handler: () => void): Promise<Disposable | undefined> {
        try {
            const api = await this.getApi();
            if (!api || typeof api.onDidChangePackages !== 'function') {
                return undefined;
            }
            return api.onDidChangePackages(() => handler());
        } catch (error) {
            traceError('Error subscribing to Python package changes: ', error);
            return undefined;
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
                return {
                    path: [resolved.executablePath, ...(resolved.args ?? [])],
                    resource,
                };
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
        if (
            version &&
            (version.major > this._minMajor || (version.major === this._minMajor && version.minor >= this._minMinor))
        ) {
            return true;
        }
        if (!version) {
            traceError(`Python version could not be determined for interpreter: ${resolved?.executablePath}`);
            traceError(`Supported versions are ${this._versionLabel} and above.`);
        } else {
            traceError(`Python version ${version.major}.${version.minor} is not supported.`);
            traceError(`Selected python path: ${resolved?.executablePath}`);
            traceError(`Supported versions are ${this._versionLabel} and above.`);
        }
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
function sameInterpreter(a: string[] | undefined, b: string[] | undefined): boolean {
    if (a === undefined || b === undefined) {
        return a === b;
    }
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

/** Compare resource-to-interpreter maps for equality. */
function sameInterpreters(a: Map<string, string[] | undefined>, b: Map<string, string[] | undefined>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [resource, interpreter] of a) {
        if (!b.has(resource) || !sameInterpreter(interpreter, b.get(resource))) {
            return false;
        }
    }
    return true;
}
