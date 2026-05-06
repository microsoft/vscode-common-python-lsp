// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { Uri, WorkspaceFolder } from 'vscode';
import {
    checkIfConfigurationChanged,
    expandTilde,
    getExtraPaths,
    getGlobalSettings,
    getWorkspaceSettings,
    logLegacySettings,
    resolveVariables,
} from '../src/settings';
import { ToolConfig } from '../src/types';
import * as vscodeapi from '../src/vscodeapi';

function makeWorkspace(name: string, fsPath: string, index: number = 0): WorkspaceFolder {
    return { uri: Uri.file(fsPath), name, index };
}

function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
    return {
        toolId: 'flake8',
        toolDisplayName: 'Flake8',
        toolModule: 'flake8',
        minimumPythonVersion: { major: 3, minor: 9 },
        configFiles: ['.flake8', 'setup.cfg'],
        settingsDefaults: {
            enabled: true,
            severity: { E: 'Error', W: 'Warning' },
            ignorePatterns: [],
            extraPaths: [],
        },
        trackedSettings: ['args', 'cwd', 'enabled', 'severity', 'path', 'interpreter', 'importStrategy'],
        serverScript: '/path/to/server.py',
        ...overrides,
    };
}

suite('settings — workspace & global resolution', () => {
    const ws = makeWorkspace('my-project', '/home/user/projects/my-project');
    let getWorkspaceFoldersStub: sinon.SinonStub;
    let getConfigurationStub: sinon.SinonStub;

    setup(() => {
        getWorkspaceFoldersStub = sinon.stub(vscodeapi, 'getWorkspaceFolders');
        getWorkspaceFoldersStub.returns([ws]);
        getConfigurationStub = sinon.stub(vscodeapi, 'getConfiguration');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('getWorkspaceSettings', () => {
        test('returns base settings with defaults', async () => {
            const configMap: Record<string, unknown> = {};
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            assert.equal(result.cwd, ws.uri.fsPath);
            assert.equal(result.workspace, ws.uri.toString());
            assert.deepEqual(result.args, []);
            assert.deepEqual(result.path, []);
            assert.deepEqual(result.interpreter, []);
            assert.equal(result.importStrategy, 'useBundled');
            assert.equal(result.showNotifications, 'off');
        });

        test('populates tool-specific settings from config', async () => {
            const configMap: Record<string, unknown> = {
                enabled: false,
                severity: { E: 'Warning' },
            };
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            assert.equal(result['enabled'], false);
            assert.deepEqual(result['severity'], { E: 'Warning' });
        });

        test('falls back to tool-specific defaults when not configured', async () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            assert.equal(result['enabled'], true);
            assert.deepEqual(result['severity'], { E: 'Error', W: 'Warning' });
        });

        test('resolves interpreter via callback when provided', async () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });

            const resolveInterpreter = sinon.stub().resolves({ path: ['/usr/bin/python3'] });
            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig, resolveInterpreter);

            assert.isTrue(resolveInterpreter.calledOnce);
            assert.include(result.interpreter.join(' '), '/usr/bin/python3');
        });

        test('uses interpreter setting when available', async () => {
            const configMap: Record<string, unknown> = {
                interpreter: ['/custom/python'],
            };
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const resolveInterpreter = sinon.stub().resolves({ path: ['/fallback/python'] });
            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig, resolveInterpreter);

            // Should NOT call resolveInterpreter since setting is set
            assert.isFalse(resolveInterpreter.called);
            assert.include(result.interpreter.join(' '), '/custom/python');
        });

        test('resolves variables in tool-specific string array settings', async () => {
            const configMap: Record<string, unknown> = {
                ignorePatterns: ['${workspaceFolder}/tests/**', '${workspaceFolder}/.venv/**'],
            };
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            assert.deepEqual(result['ignorePatterns'], [
                `${ws.uri.fsPath}/tests/**`,
                `${ws.uri.fsPath}/.venv/**`,
            ]);
        });

        test('does not resolve variables in non-array tool-specific settings', async () => {
            const configMap: Record<string, unknown> = {
                severity: { E: '${workspaceFolder}' },
            };
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            // severity is an object, not a string array — should NOT be resolved
            assert.deepEqual(result['severity'], { E: '${workspaceFolder}' });
        });

        test('expands tilde in cwd', async () => {
            const configMap: Record<string, unknown> = {
                cwd: '~/my-project',
            };
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) => configMap[key] ?? def,
            });

            const toolConfig = makeToolConfig();
            const result = await getWorkspaceSettings('flake8', ws, toolConfig);

            assert.isFalse(result.cwd.startsWith('~'));
        });
    });

    suite('getGlobalSettings', () => {
        test('returns base settings with global defaults', async () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
                inspect: () => ({ globalValue: undefined, defaultValue: undefined }),
            });

            const toolConfig = makeToolConfig();
            const result = await getGlobalSettings('flake8', toolConfig);

            assert.equal(result.cwd, process.cwd());
            assert.equal(result.workspace, process.cwd());
            assert.equal(result.importStrategy, 'fromEnvironment');
        });

        test('uses global value when set', async () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
                inspect: (key: string) => {
                    if (key === 'args') {
                        return { globalValue: ['--strict'], defaultValue: [] };
                    }
                    return { globalValue: undefined, defaultValue: undefined };
                },
            });

            const toolConfig = makeToolConfig();
            const result = await getGlobalSettings('flake8', toolConfig);

            assert.deepEqual(result.args, ['--strict']);
        });
    });

    suite('getExtraPaths', () => {
        test('returns tool-specific extraPaths when set', () => {
            getConfigurationStub.callsFake((namespace: string) => {
                if (namespace === 'flake8') {
                    return { get: (key: string, def?: unknown) => (key === 'extraPaths' ? ['/custom/path'] : def) };
                }
                return { get: (_key: string, def?: unknown) => def };
            });

            const result = getExtraPaths('flake8', ws);
            assert.deepEqual(result, ['/custom/path']);
        });

        test('falls back to python.analysis.extraPaths', () => {
            getConfigurationStub.callsFake((namespace: string) => {
                if (namespace === 'flake8') {
                    return { get: (_key: string, def?: unknown) => def };
                }
                if (namespace === 'python') {
                    return {
                        get: (key: string, def?: unknown) =>
                            key === 'analysis.extraPaths' ? ['/legacy/path'] : def,
                    };
                }
                return { get: (_key: string, def?: unknown) => def };
            });

            const result = getExtraPaths('flake8', ws);
            assert.deepEqual(result, ['/legacy/path']);
        });

        test('returns empty when nothing configured', () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });

            const result = getExtraPaths('flake8', ws);
            assert.deepEqual(result, []);
        });
    });

    suite('checkIfConfigurationChanged', () => {
        test('returns true when tracked setting changes', () => {
            const event = {
                affectsConfiguration: (s: string) => s === 'flake8.args',
            } as unknown as import('vscode').ConfigurationChangeEvent;

            const result = checkIfConfigurationChanged(event, 'flake8', ['args', 'cwd', 'path']);
            assert.isTrue(result);
        });

        test('returns false when no tracked setting changes', () => {
            const event = {
                affectsConfiguration: () => false,
            } as unknown as import('vscode').ConfigurationChangeEvent;

            const result = checkIfConfigurationChanged(event, 'flake8', ['args', 'cwd', 'path']);
            assert.isFalse(result);
        });
    });

    suite('logLegacySettings', () => {
        test('does not throw with empty mappings', () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });

            assert.doesNotThrow(() => logLegacySettings('flake8', []));
        });

        test('does not throw with valid mappings', () => {
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });

            assert.doesNotThrow(() =>
                logLegacySettings('flake8', [
                    { legacyKey: 'linting.flake8Enabled', newKey: 'enabled' },
                    { legacyKey: 'linting.flake8Args', newKey: 'args', isArray: true },
                ]),
            );
        });
    });
});
