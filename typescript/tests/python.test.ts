// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { EventEmitter, Uri } from 'vscode';
import { PythonEnvironmentsProvider, IInterpreterDetails } from '../src/python';
import { IResolvedPythonEnvironment, ToolConfig } from '../src/types';
import * as utilities from '../src/utilities';

function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
    return {
        toolId: 'flake8',
        toolDisplayName: 'Flake8',
        toolModule: 'flake8',
        minimumPythonVersion: { major: 3, minor: 9 },
        configFiles: [],
        settingsDefaults: {},
        trackedSettings: [],
        serverScript: '/path/to/server.py',
        ...overrides,
    };
}

suite('PythonEnvironmentsProvider', () => {
    let getProjectRootStub: sinon.SinonStub;

    setup(() => {
        getProjectRootStub = sinon.stub(utilities, 'getProjectRoot');
        getProjectRootStub.resolves(undefined);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('constructor', () => {
        test('stores minimum version from config', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 10 } });
            const provider = new PythonEnvironmentsProvider(config);
            assert.isDefined(provider);
        });
    });

    suite('checkVersion', () => {
        test('returns true for supported version', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 9 } });
            const provider = new PythonEnvironmentsProvider(config);

            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python3',
                version: { major: 3, minor: 10, micro: 0 },
            };

            assert.isTrue(provider.checkVersion(resolved));
        });

        test('returns true for exact minimum version', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 9 } });
            const provider = new PythonEnvironmentsProvider(config);

            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python3',
                version: { major: 3, minor: 9, micro: 1 },
            };

            assert.isTrue(provider.checkVersion(resolved));
        });

        test('returns false for version below minimum', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 9 } });
            const provider = new PythonEnvironmentsProvider(config);

            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python3',
                version: { major: 3, minor: 8, micro: 0 },
            };

            assert.isFalse(provider.checkVersion(resolved));
        });

        test('returns false for different major version', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 9 } });
            const provider = new PythonEnvironmentsProvider(config);

            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python2',
                version: { major: 2, minor: 7, micro: 0 },
            };

            assert.isFalse(provider.checkVersion(resolved));
        });

        test('returns true for higher major version', () => {
            const config = makeToolConfig({ minimumPythonVersion: { major: 3, minor: 9 } });
            const provider = new PythonEnvironmentsProvider(config);

            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python4',
                version: { major: 4, minor: 0, micro: 0 },
            };

            assert.isTrue(provider.checkVersion(resolved));
        });

        test('returns false for undefined resolved', () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            assert.isFalse(provider.checkVersion(undefined));
        });

        test('returns false for missing version', () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            const resolved: IResolvedPythonEnvironment = {
                executablePath: '/usr/bin/python3',
                version: undefined,
            };
            assert.isFalse(provider.checkVersion(resolved));
        });
    });

    suite('onDidChangeInterpreter', () => {
        test('event is defined', () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            assert.isDefined(provider.onDidChangeInterpreter);
        });
    });

    suite('initializePython', () => {
        test('returns without throwing when no API is available', async () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            // No Python extension is available in the test environment, so
            // getApi() resolves to undefined and initializePython returns early.
            const disposables: { dispose: () => void }[] = [];
            await provider.initializePython(disposables);
            assert.isArray(disposables);
        });

        test('supports an environments API without project events', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            const internal = provider as unknown as { _api: unknown; _apiResolved: boolean };
            internal._api = {
                extension: 'ms-python.python-environments',
                getEnvironment: sinon.stub().resolves({
                    executablePath: '/root/python',
                    version: { major: 3, minor: 10, micro: 0 },
                }),
                onDidChangeEnvironment: sinon.stub().returns({ dispose: sinon.stub() }),
            };
            internal._apiResolved = true;
            const disposables: { dispose: () => void }[] = [];

            await provider.initializePython(
                disposables,
                async () => [Uri.parse('file:///workspace')],
                false,
            );

            assert.lengthOf(disposables, 1);
        });

        test('fires when a nested project interpreter changes', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            const environmentChanged = new EventEmitter<void>();
            const projectsChanged = new EventEmitter<void>();
            const interpreters = new Map([
                ['file:///workspace', '/root/python'],
                ['file:///workspace/project', '/project/python'],
            ]);
            const api = {
                extension: 'ms-python.python-environments',
                getEnvironment: async (resource?: Uri) => {
                    const executablePath = interpreters.get(resource?.toString() ?? '');
                    return executablePath
                        ? { executablePath, version: { major: 3, minor: 10, micro: 0 } }
                        : undefined;
                },
                resolveEnvironment: sinon.stub(),
                onDidChangeEnvironment: environmentChanged.event,
                getPythonProjects: sinon.stub().resolves([]),
                onDidChangePythonProjects: projectsChanged.event,
                onDidChangePackages: sinon.stub().returns({ dispose: sinon.stub() }),
                getDebuggerPath: sinon.stub().resolves(undefined),
            };
            const internal = provider as unknown as { _api: unknown; _apiResolved: boolean };
            internal._api = api;
            internal._apiResolved = true;

            const resources = async () => [
                Uri.parse('file:///workspace'),
                Uri.parse('file:///workspace/project'),
            ];
            const changes = sinon.stub();
            provider.onDidChangeInterpreter(changes);
            const disposables: { dispose: () => void }[] = [];
            await provider.initializePython(disposables, resources, false);

            interpreters.set('file:///workspace/project', '/project/new-python');
            environmentChanged.fire();
            await new Promise((resolve) => setImmediate(resolve));

            assert.isTrue(changes.calledOnce);
        });

        test('fires when the Python project set changes', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            const environmentChanged = new EventEmitter<void>();
            const projectsChanged = new EventEmitter<void>();
            let resources = [Uri.parse('file:///workspace')];
            const api = {
                extension: 'ms-python.python-environments',
                getEnvironment: async (resource?: Uri) => ({
                    executablePath: `${resource?.fsPath}/python`,
                    version: { major: 3, minor: 10, micro: 0 },
                }),
                resolveEnvironment: sinon.stub(),
                onDidChangeEnvironment: environmentChanged.event,
                getPythonProjects: sinon.stub().resolves([]),
                onDidChangePythonProjects: projectsChanged.event,
                onDidChangePackages: sinon.stub().returns({ dispose: sinon.stub() }),
                getDebuggerPath: sinon.stub().resolves(undefined),
            };
            const internal = provider as unknown as { _api: unknown; _apiResolved: boolean };
            internal._api = api;
            internal._apiResolved = true;

            const changes = sinon.stub();
            provider.onDidChangeInterpreter(changes);
            const disposables: { dispose: () => void }[] = [];
            await provider.initializePython(disposables, async () => resources, false);

            resources = [...resources, Uri.parse('file:///workspace/project')];
            projectsChanged.fire();
            await new Promise((resolve) => setImmediate(resolve));

            assert.isTrue(changes.calledOnce);
        });
    });

    suite('subscribeToPackageChanges', () => {
        function injectApi(provider: PythonEnvironmentsProvider, api: unknown): void {
            const internal = provider as unknown as { _api: unknown; _apiResolved: boolean };
            internal._api = api;
            internal._apiResolved = true;
        }

        test('subscribes to onDidChangePackages and forwards events to the handler', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());

            let firePackages: (() => void) | undefined;
            const disposeStub = sinon.stub();
            injectApi(provider, {
                extension: 'ms-python.python-environments',
                onDidChangePackages: (handler: () => void) => {
                    firePackages = handler;
                    return { dispose: disposeStub };
                },
            });

            const handler = sinon.stub();
            const disposable = await provider.subscribeToPackageChanges(handler);

            assert.isDefined(disposable, 'should return a disposable');
            assert.isFunction(firePackages, 'should subscribe to the event');

            firePackages?.();
            assert.isTrue(handler.calledOnce, 'should forward the event to the handler');
        });

        test('returns undefined when the API does not expose onDidChangePackages', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            injectApi(provider, { extension: 'ms-python.python' });

            const disposable = await provider.subscribeToPackageChanges(sinon.stub());
            assert.isUndefined(disposable);
        });

        test('returns undefined when no API is available', async () => {
            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            const disposable = await provider.subscribeToPackageChanges(sinon.stub());
            assert.isUndefined(disposable);
        });
    });

    suite('dispose', () => {
        test('does not throw', () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            assert.doesNotThrow(() => provider.dispose());
        });
    });

    suite('getInterpreterDetails', () => {
        test('returns empty path when no API available', async () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);

            // Both APIs throw in test environment — getInterpreterDetails catches errors
            // and returns { path: undefined }
            const result: IInterpreterDetails = await provider.getInterpreterDetails();
            assert.isUndefined(result.path);
        });

        suite('getPythonProjects', () => {
            test('returns projects from the active API', async () => {
                const provider = new PythonEnvironmentsProvider(makeToolConfig());
                const projects = [{ name: 'project', uri: Uri.parse('file:///workspace/project') }];
                const internal = provider as unknown as { _api: unknown; _apiResolved: boolean };
                internal._api = { getPythonProjects: sinon.stub().resolves(projects) };
                internal._apiResolved = true;

                assert.deepEqual(await provider.getPythonProjects(), projects);
            });
        });
    });

    suite('resolveInterpreter', () => {
        test('returns undefined for empty array', async () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            const result = await provider.resolveInterpreter([]);
            assert.isUndefined(result);
        });

        test('returns undefined when APIs are unavailable', async () => {
            const config = makeToolConfig();
            const provider = new PythonEnvironmentsProvider(config);
            // Both APIs throw in test — should catch and return undefined
            const result = await provider.resolveInterpreter(['/usr/bin/python3']);
            assert.isUndefined(result);
        });
    });
});
