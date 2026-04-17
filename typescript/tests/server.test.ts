// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { LanguageStatusSeverity, LogOutputChannel, Uri, LogLevel, WorkspaceFolder } from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { getServerCwd, createServer, restartServer, CreateServerOptions, RestartServerOptions, RestartServerResult } from '../src/server';
import * as envFileModule from '../src/envFile';
import * as status from '../src/status';
import * as utilities from '../src/utilities';
import * as vscodeapi from '../src/vscodeapi';
import * as settingsModule from '../src/settings';
import { IBaseSettings, ToolConfig } from '../src/types';
import { PythonEnvironmentsProvider } from '../src/python';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides?: Partial<IBaseSettings>): IBaseSettings {
    return {
        cwd: '/workspace',
        workspace: 'file:///workspace',
        args: [],
        path: [],
        interpreter: ['/usr/bin/python3'],
        importStrategy: 'useBundled',
        showNotifications: 'off',
        ...overrides,
    };
}

function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
    return {
        toolId: 'flake8',
        toolDisplayName: 'Flake8',
        toolModule: 'flake8',
        minimumPythonVersion: { major: 3, minor: 10 },
        configFiles: [],
        settingsDefaults: {},
        trackedSettings: [],
        serverScript: '/path/to/server.py',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// getServerCwd
// ---------------------------------------------------------------------------

suite('getServerCwd', () => {
    test('returns cwd unchanged for plain path', () => {
        const settings = makeSettings({ cwd: '/my/project' });
        assert.strictEqual(getServerCwd(settings), '/my/project');
    });

    test('returns cwd unchanged for ${workspaceFolder}', () => {
        const settings = makeSettings({ cwd: '${workspaceFolder}/sub' });
        assert.strictEqual(getServerCwd(settings), '${workspaceFolder}/sub');
    });

    test('falls back to workspace path for ${file}', () => {
        const settings = makeSettings({ cwd: '${file}', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${file}');
    });

    test('falls back for ${fileDirname}', () => {
        const settings = makeSettings({ cwd: '${fileDirname}', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${fileDirname}');
    });

    test('falls back for ${relativeFile}', () => {
        const settings = makeSettings({ cwd: '${relativeFile}', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${relativeFile}');
    });

    test('falls back for ${relativeFileDirname}', () => {
        const settings = makeSettings({
            cwd: '${relativeFileDirname}',
            workspace: 'file:///workspace',
        });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${relativeFileDirname}');
    });

    test('falls back for ${fileBasename}', () => {
        const settings = makeSettings({ cwd: '${fileBasename}', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${fileBasename}');
    });

    test('falls back for embedded file-variable', () => {
        const settings = makeSettings({
            cwd: '/project/${fileDirname}/sub',
            workspace: 'file:///workspace',
        });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${fileDirname}');
    });
});

// ---------------------------------------------------------------------------
// createServer
// ---------------------------------------------------------------------------

suite('createServer', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(envFileModule, 'getEnvFileVars').resolves({});
        sandbox.stub(vscodeapi, 'getWorkspaceFolder').returns({
            uri: Uri.parse('file:///workspace'),
            name: 'workspace',
            index: 0,
        } as WorkspaceFolder);
        sandbox.stub(utilities, 'getDocumentSelector').returns([{ language: 'python' }]);
    });

    teardown(() => {
        sandbox.restore();
    });

    function makeCreateOptions(overrides?: Partial<CreateServerOptions>): CreateServerOptions {
        return {
            settings: makeSettings(),
            serverId: 'flake8',
            serverName: 'Flake8',
            outputChannel: { logLevel: LogLevel.Info } as unknown as LogOutputChannel,
            initializationOptions: { settings: [], globalSettings: makeSettings() },
            toolConfig: makeToolConfig(),
            ...overrides,
        };
    }

    test('returns a LanguageClient instance', async () => {
        const client = await createServer(makeCreateOptions());
        assert.instanceOf(client, LanguageClient);
    });

    test('sets LS_IMPORT_STRATEGY from settings', async () => {
        const options = makeCreateOptions({
            settings: makeSettings({ importStrategy: 'fromEnvironment' }),
        });
        const client = await createServer(options);
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string> } } }).serverOptions).options.env;
        assert.strictEqual(env.LS_IMPORT_STRATEGY, 'fromEnvironment');
    });

    test('creates client with pythonUtf8 default (true)', async () => {
        const client = await createServer(makeCreateOptions());
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string> } } }).serverOptions).options.env;
        assert.strictEqual(env.PYTHONUTF8, '1');
    });

    test('creates client when pythonUtf8 is false', async () => {
        const options = makeCreateOptions({
            toolConfig: makeToolConfig({ pythonUtf8: false }),
        });
        const client = await createServer(options);
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string | undefined> } } }).serverOptions).options.env;
        assert.isUndefined(env.PYTHONUTF8, 'PYTHONUTF8 should not be set when pythonUtf8 is false');
    });

    test('merges extraEnvVars from toolConfig', async () => {
        const options = makeCreateOptions({
            toolConfig: makeToolConfig({
                extraEnvVars: { VSCODE_PYLINT_LINT_ON_CHANGE: 'yes' },
            }),
        });
        const client = await createServer(options);
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string> } } }).serverOptions).options.env;
        assert.strictEqual(env.VSCODE_PYLINT_LINT_ON_CHANGE, 'yes');
    });

    test('uses serverScript from toolConfig', async () => {
        const options = makeCreateOptions({
            toolConfig: makeToolConfig({ serverScript: '/custom/server.py' }),
        });
        const client = await createServer(options);
        const args = (client as unknown as { serverOptions: { args: string[] } }).serverOptions.args;
        assert.include(args, '/custom/server.py');
    });

    test('handles extraPaths in settings', async () => {
        const options = makeCreateOptions({
            settings: {
                ...makeSettings(),
                extraPaths: ['/extra/lib1', '/extra/lib2'],
            },
        });
        const client = await createServer(options);
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string> } } }).serverOptions).options.env;
        assert.include(env.PYTHONPATH, '/extra/lib1');
        assert.include(env.PYTHONPATH, '/extra/lib2');
    });

    test('merges env file vars', async () => {
        (envFileModule.getEnvFileVars as sinon.SinonStub).resolves({
            PYTHONPATH: '/envfile/path',
        });
        const client = await createServer(makeCreateOptions());
        const env = ((client as unknown as { serverOptions: { options: { env: Record<string, string> } } }).serverOptions).options.env;
        assert.include(env.PYTHONPATH, '/envfile/path');
    });

    test('throws when interpreter array is empty', async () => {
        const options = makeCreateOptions({
            settings: makeSettings({ interpreter: [] }),
        });
        try {
            await createServer(options);
            assert.fail('should have thrown');
        } catch (err: unknown) {
            assert.include((err as Error).message, 'no Python interpreter');
        }
    });
});

// ---------------------------------------------------------------------------
// restartServer
// ---------------------------------------------------------------------------

suite('restartServer', () => {
    let sandbox: sinon.SinonSandbox;
    let updateStatusStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        updateStatusStub = sandbox.stub(status, 'updateStatus');
        sandbox.stub(envFileModule, 'getEnvFileVars').resolves({});
        sandbox.stub(vscodeapi, 'getWorkspaceFolder').returns({
            uri: Uri.parse('file:///workspace'),
            name: 'workspace',
            index: 0,
        } as WorkspaceFolder);
        sandbox.stub(utilities, 'getDocumentSelector').returns([{ language: 'python' }]);
        sandbox.stub(utilities, 'getLSClientTraceLevel').returns(0 as unknown as ReturnType<typeof utilities.getLSClientTraceLevel>);
        sandbox.stub(settingsModule, 'getExtensionSettings').resolves([]);
        sandbox.stub(settingsModule, 'getGlobalSettings').resolves(makeSettings());
    });

    teardown(() => {
        sandbox.restore();
    });

    function makeMockProvider(): PythonEnvironmentsProvider {
        return {
            getInterpreterDetails: sandbox.stub().resolves({ path: ['/usr/bin/python3'] }),
            getDebuggerPath: sandbox.stub().resolves(undefined),
        } as unknown as PythonEnvironmentsProvider;
    }

    function makeRestartOptions(overrides?: Partial<RestartServerOptions>): RestartServerOptions {
        return {
            settings: makeSettings(),
            serverId: 'flake8',
            serverName: 'Flake8',
            outputChannel: { logLevel: LogLevel.Info } as unknown as LogOutputChannel,
            toolConfig: makeToolConfig(),
            pythonProvider: makeMockProvider(),
            ...overrides,
        };
    }

    test('returns a result with client and disposables', async () => {
        const result = await restartServer(makeRestartOptions());
        assert.isDefined(result.client);
        assert.isArray(result.disposables);
        assert.isAbove(result.disposables.length, 0);
    });

    test('stops old client before creating new one', async () => {
        const oldStop = sandbox.stub().resolves();
        const oldClient = { stop: oldStop } as unknown as LanguageClient;

        await restartServer(makeRestartOptions(), oldClient);
        assert.isTrue(oldStop.calledOnce, 'old client stop() should be called');
    });

    test('handles old client stop failure gracefully', async () => {
        const oldClient = {
            stop: sandbox.stub().rejects(new Error('stop failed')),
        } as unknown as LanguageClient;

        // Should not throw
        const result = await restartServer(makeRestartOptions(), oldClient);
        assert.isDefined(result.client);
    });

    test('updates status to busy during restart', async () => {
        await restartServer(makeRestartOptions());
        assert.isTrue(
            updateStatusStub.calledWith(undefined, LanguageStatusSeverity.Information, true),
            'updateStatus should be called with busy=true',
        );
    });
});
