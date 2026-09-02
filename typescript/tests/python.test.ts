// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { PythonEnvironments } from '@vscode/python-environments';
import { PythonExtension } from '@vscode/python-extension';
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

        for (const [description, incompleteApi] of [
            ['undefined', undefined],
            ['an empty object', {}],
        ] as const) {
            test(`falls back to the legacy API when the environments API returns ${description}`, async () => {
                const environmentsApi = sinon.stub(PythonEnvironments, 'api').resolves(incompleteApi as never);

                const onDidChangeActiveEnvironmentPath = sinon.stub().returns({ dispose: sinon.stub() });
                const resolveEnvironment = sinon.stub().resolves({
                    executable: { uri: { fsPath: '/usr/bin/python3' } },
                    version: { major: 3, minor: 12, micro: 1 },
                });
                const legacyApi = sinon.stub(PythonExtension, 'api').resolves({
                    environments: {
                        getActiveEnvironmentPath: sinon.stub().returns('/usr/bin/python3'),
                        onDidChangeActiveEnvironmentPath,
                        resolveEnvironment,
                    },
                    debug: {
                        getDebuggerPackagePath: sinon.stub().resolves(undefined),
                    },
                } as never);

                const provider = new PythonEnvironmentsProvider(makeToolConfig());
                const disposables: { dispose: () => void }[] = [];

                await provider.initializePython(disposables);

                assert.isTrue(environmentsApi.calledOnce, 'should try the environments API first');
                assert.isTrue(legacyApi.calledOnce, 'should try the legacy API');
                assert.isTrue(
                    onDidChangeActiveEnvironmentPath.calledOnce,
                    'should subscribe through the legacy API',
                );
                assert.lengthOf(disposables, 1);

                const interpreter = await provider.getInterpreterDetails();
                assert.deepEqual(interpreter.path, ['/usr/bin/python3']);
                assert.isTrue(resolveEnvironment.calledTwice, 'should cache and reuse the legacy API');
                assert.isTrue(environmentsApi.calledOnce, 'should not retry the environments API');
                assert.isTrue(legacyApi.calledOnce, 'should reuse the cached legacy API');
            });
        }

        test('uses the environments API when only the optional package event is unavailable', async () => {
            const onDidChangeEnvironment = sinon.stub().returns({ dispose: sinon.stub() });
            const environmentsApi = sinon.stub(PythonEnvironments, 'api').resolves({
                getEnvironment: sinon.stub().resolves(undefined),
                resolveEnvironment: sinon.stub().resolves(undefined),
                onDidChangeEnvironment,
            } as never);
            const legacyApi = sinon.stub(PythonExtension, 'api');

            const provider = new PythonEnvironmentsProvider(makeToolConfig());
            const disposables: { dispose: () => void }[] = [];

            await provider.initializePython(disposables);

            assert.isTrue(environmentsApi.calledOnce);
            assert.isFalse(legacyApi.called);
            assert.isTrue(onDidChangeEnvironment.calledOnce);
            assert.lengthOf(disposables, 1);

            const packageDisposable = await provider.subscribeToPackageChanges(sinon.stub());
            assert.isDefined(packageDisposable);
            assert.isTrue(environmentsApi.calledOnce, 'should reuse the cached environments API');
            packageDisposable?.dispose();
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
