// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as sinon from 'sinon';
import { pathToFileURL } from 'url';
import { Uri, WorkspaceFolder } from 'vscode';
import { ToolDefinition } from '../src';
import {
    checkIfConfigurationChanged,
    expandTilde,
    getExtraPaths,
    getExtensionSettings,
    getGlobalSettings,
    getWorkspaceSettings,
    logLegacySettings,
    resolveVariables,
} from '../src/settings';
import { IInitOptions, ToolConfig } from '../src/types';
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

    test('produces the shared initialization fixture with document CWD variables deferred', async () => {
        const root = makeWorkspace('contract', path.resolve('settings workspace café'));
        const rootUri = pathToFileURL(root.uri.fsPath).href;
        sinon.stub(root.uri, 'toString').returns(rootUri);
        getWorkspaceFoldersStub.returns([root]);
        sinon.stub(vscodeapi, 'getWorkspaceFolder').returns(root);
        const replacements = new Map([
            ['__ROOT_URI__', rootUri],
            ['__ROOT_FS__', root.uri.fsPath],
            ['__CWD_FS__', process.cwd()],
            ['__PYTHON__', path.join(root.uri.fsPath, 'python')],
            ['__SEP__', path.sep],
        ]);
        const fixturePath = path.resolve(
            __dirname,
            '..',
            '..',
            '..',
            'python',
            'tests',
            'fixtures',
            'settings',
            'producer.json',
        );
        interface FixtureSettings {
            severity: Record<string, string>;
            extensionOption: { enabled: boolean; label?: string };
        }
        const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'), (_key: string, value: unknown) => {
            if (typeof value !== 'string') {
                return value;
            }
            let expanded = value;
            for (const [token, replacement] of replacements) {
                expanded = expanded.split(token).join(replacement);
            }
            return expanded;
        }) as {
            toolDefaults: ToolDefinition<FixtureSettings>['settingsDefaults'];
            configuration: { workspace: Record<string, unknown>; global: Record<string, unknown> };
            initializationOptions: IInitOptions;
        };
        getConfigurationStub.returns({
            get: (key: string, fallback?: unknown) =>
                key in fixture.configuration.workspace ? fixture.configuration.workspace[key] : fallback,
            inspect: (key: string) => ({ globalValue: fixture.configuration.global[key] }),
        });
        const toolConfig = makeToolConfig({ settingsDefaults: fixture.toolDefaults });

        const actual: IInitOptions = {
            settings: await getExtensionSettings('flake8', toolConfig, undefined, [root]),
            globalSettings: await getGlobalSettings('flake8', toolConfig),
        };

        assert.deepEqual(actual, fixture.initializationOptions);

        const typedToolConfig: ToolDefinition<FixtureSettings> = {
            ...toolConfig,
            settingsDefaults: fixture.toolDefaults,
        };
        const typed: IInitOptions = {
            settings: await getExtensionSettings('flake8', typedToolConfig, undefined, [root]),
            globalSettings: await getGlobalSettings('flake8', typedToolConfig),
        };
        assert.deepEqual(typed, actual);
        assert.deepEqual(await getWorkspaceSettings('flake8', root, typedToolConfig), actual.settings[0]);
    });

    test('typed definitions preserve defaults and project only declared custom keys', async () => {
        interface OptionalSettings {
            enabled: boolean;
            ignorePatterns: string[];
            optionalLabel?: string;
        }
        const typed: ToolDefinition<OptionalSettings> = {
            ...makeToolConfig(),
            settingsDefaults: { enabled: false, ignorePatterns: [] },
            trackedSettings: ['enabled', 'ignorePatterns', 'envFile'],
        };
        const configured: Record<string, unknown> = {
            optionalLabel: 'not projected without a default',
            envFile: 'client-only.env',
            futureOption: true,
        };
        getConfigurationStub.returns({
            get: (key: string, fallback?: unknown) => configured[key] ?? fallback,
            inspect: (key: string) => ({ globalValue: configured[key] }),
        });
        const legacy: ToolConfig = typed;
        const typedInitialization: IInitOptions = {
            settings: await getExtensionSettings('flake8', typed),
            globalSettings: await getGlobalSettings('flake8', typed),
        };
        assert.deepEqual(typedInitialization, {
            settings: await getExtensionSettings('flake8', legacy),
            globalSettings: await getGlobalSettings('flake8', legacy),
        });
        for (const resolved of [...typedInitialization.settings, typedInitialization.globalSettings]) {
            assert.isFalse(resolved.enabled);
            assert.deepEqual(resolved.ignorePatterns, []);
            assert.notProperty(resolved, 'optionalLabel');
            assert.notProperty(resolved, 'envFile');
            assert.notProperty(resolved, 'futureOption');
        }
        assert.deepEqual(Object.keys(typedInitialization).sort(), ['globalSettings', 'settings']);
        assert.isTrue(
            checkIfConfigurationChanged(
                { affectsConfiguration: (key: string) => key === 'flake8.envFile' },
                'flake8',
                typed.trackedSettings,
            ),
        );
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

        test('resolves a project interpreter while preserving workspace variables', async () => {
            const project = makeWorkspace('nested-project', '/home/user/projects/my-project/nested');
            getConfigurationStub.returns({
                get: (key: string, def?: unknown) =>
                    key === 'args' ? ['--config-file', '${workspaceFolder}/pyproject.toml'] : def,
            });
            sinon.stub(vscodeapi, 'getWorkspaceFolder').withArgs(project.uri).returns(ws);
            const resolveInterpreter = sinon.stub().resolves({ path: ['/project/python'] });

            const result = await getWorkspaceSettings(
                'flake8',
                project,
                makeToolConfig(),
                resolveInterpreter,
            );

            assert.equal(result.workspace, project.uri.toString());
            assert.deepEqual(result.interpreter, ['/project/python']);
            assert.deepEqual(result.args, [
                '--config-file',
                `${ws.uri.fsPath}/pyproject.toml`,
            ]);
            assert.isTrue(resolveInterpreter.calledWith(project.uri));
        });
    });

    suite('getExtensionSettings', () => {
        test('resolves settings for explicitly supplied project roots', async () => {
            const project = makeWorkspace('nested-project', '/home/user/projects/my-project/nested');
            getConfigurationStub.returns({
                get: (_key: string, def?: unknown) => def,
            });
            const resolveInterpreter = sinon.stub().callsFake(async (resource: Uri) => ({
                path: [`${resource.fsPath}/python`],
            }));

            const result = await getExtensionSettings(
                'flake8',
                makeToolConfig(),
                resolveInterpreter,
                [ws, project],
            );

            assert.deepEqual(
                result.map((settings) => settings.workspace),
                [ws.uri.toString(), project.uri.toString()],
            );
            assert.deepEqual(result[1].interpreter, [`${project.uri.fsPath}/python`]);
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

        for (const [label, globalValue, expected] of [
            ['null uses the contribution default', null, 'useBundled'],
            ['empty string overrides the contribution default', '', ''],
        ] as const) {
            test(`preserves scope precedence: ${label}`, async () => {
                const contributionDefaults: Record<string, unknown> = {
                    importStrategy: 'useBundled',
                    args: ['--contribution'],
                    interpreter: ['/contribution/python'],
                    cwd: process.cwd(),
                    enabled: true,
                    severity: { E: 'Hint' },
                };
                const globalValues: Record<string, unknown> = {
                    importStrategy: globalValue,
                    args: [],
                    interpreter: [],
                    cwd: '',
                    enabled: false,
                    severity: null,
                };
                getConfigurationStub.returns({
                    get: (key: string, fallback?: unknown) =>
                        key === 'importStrategy' ? 'fromEnvironment' : fallback,
                    inspect: (key: string) => ({
                        globalValue: globalValues[key],
                        defaultValue: contributionDefaults[key],
                    }),
                });
                const toolConfig = makeToolConfig();

                const global = await getGlobalSettings('flake8', toolConfig);
                const workspace = await getWorkspaceSettings('flake8', ws, toolConfig);

                assert.equal(global.importStrategy, expected);
                assert.equal(workspace.importStrategy, 'fromEnvironment');
                assert.deepEqual(global.args, []);
                assert.deepEqual(global.interpreter, []);
                assert.equal(global.cwd, '');
                assert.isFalse(global.enabled);
                assert.deepEqual(global.severity, { E: 'Hint' });
            });
        }
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
