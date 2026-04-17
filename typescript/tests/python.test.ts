// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
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
