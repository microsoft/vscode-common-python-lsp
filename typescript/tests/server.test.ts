// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { LanguageStatusSeverity, LogOutputChannel, Uri, LogLevel, WorkspaceFolder } from 'vscode';
import { State } from 'vscode-languageclient';
import { LanguageClient } from 'vscode-languageclient/node';
import { getServerCwd, createServer, restartServer, CreateServerOptions, RestartServerOptions, RestartServerResult } from '../src/server';
import * as envFileModule from '../src/envFile';
import * as status from '../src/status';
import * as utilities from '../src/utilities';
import * as vscodeapi from '../src/vscodeapi';
import * as settingsModule from '../src/settings';
import { IBaseSettings, IInitOptions, ToolConfig } from '../src/types';
import { PythonEnvironmentsProvider } from '../src/python';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

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

    // Any ${...} token still present when getServerCwd runs is unresolved
    // (per-document variable, undefined env var, or typo). The broader regex
    // falls back to the workspace path so the server can start.
    test('falls back for any unresolved ${...} token reaching getServerCwd', () => {
        const settings = makeSettings({ cwd: '${workspceFolder}/sub', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.strictEqual(result, '/workspace');
    });

    // Regression: vscode-mypy#556 — tool-specific per-document token
    test('falls back to workspace path for ${nearestConfig}', () => {
        const settings = makeSettings({ cwd: '${nearestConfig}', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${nearestConfig}');
        assert.strictEqual(result, '/workspace');
    });

    test('falls back for path combining literal prefix with ${nearestConfig}', () => {
        const settings = makeSettings({ cwd: '${nearestConfig}/src', workspace: 'file:///workspace' });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${nearestConfig}');
        assert.strictEqual(result, '/workspace');
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

    test('handles Windows drive path as workspace', () => {
        const settings = makeSettings({
            cwd: '${fileDirname}',
            workspace: 'C:\\Users\\dev\\project',
        });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${fileDirname}');
        // Should route through Uri.file(), not misparse 'C:' as a URI scheme
        assert.include(result, 'Users');
    });

    test('handles plain Unix path as workspace', () => {
        const settings = makeSettings({
            cwd: '${file}',
            workspace: '/home/dev/project',
        });
        const result = getServerCwd(settings);
        assert.notInclude(result, '${file}');
        assert.include(result, '/home/dev/project');
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

    function disposeResult(result?: RestartServerResult): void {
        result?.disposables.forEach((disposable) => disposable.dispose());
        result?.client?.dispose();
    }

    test('returns a result with client and disposables', async () => {
        const result = await restartServer(makeRestartOptions());
        assert.isDefined(result.client);
        assert.isArray(result.disposables);
        assert.isAbove(result.disposables.length, 0);
    });

    test('awaits old client stop before creating and starting the replacement', async () => {
        const entered = deferred<void>();
        const finished = deferred<void>();
        const oldStop = sandbox.stub().callsFake(() => {
            entered.resolve();
            return finished.promise;
        });
        const oldClient = { stop: oldStop } as unknown as LanguageClient;
        const startSpy = sandbox.spy(LanguageClient.prototype, 'start');
        const options = makeRestartOptions();
        const restarting = restartServer(options, oldClient);
        let result: RestartServerResult | undefined;

        try {
            await entered.promise;
            sinon.assert.calledOnce(oldStop);
            sinon.assert.notCalled(envFileModule.getEnvFileVars as sinon.SinonStub);
            sinon.assert.notCalled(startSpy);
            sinon.assert.notCalled(updateStatusStub);

            finished.resolve();
            result = await restarting;
            assert.isDefined(result.client);
            sinon.assert.calledOnce(startSpy);
            sinon.assert.callOrder(oldStop, envFileModule.getEnvFileVars as sinon.SinonStub, startSpy);
        } finally {
            finished.resolve();
            result ??= await restarting;
            disposeResult(result);
        }
    });

    test('handles old client stop failure gracefully', async () => {
        const oldClient = {
            stop: sandbox.stub().rejects(new Error('stop failed')),
        } as unknown as LanguageClient;

        const startSpy = sandbox.spy(LanguageClient.prototype, 'start');
        const result = await restartServer(makeRestartOptions(), oldClient);
        try {
            assert.isDefined(result.client);
            sinon.assert.calledOnce(startSpy);
            assert.deepEqual(updateStatusStub.lastCall.args, [
                undefined, LanguageStatusSeverity.Information, false,
            ]);
        } finally {
            disposeResult(result);
        }
    });

    test('awaits start and trace before clearing busy and installing the state listener', async () => {
        const startEntered = deferred<LanguageClient>();
        const startFinished = deferred<void>();
        const traceEntered = deferred<void>();
        const traceFinished = deferred<void>();
        const originalStart = LanguageClient.prototype.start;
        const startStub = sandbox.stub(LanguageClient.prototype, 'start').callsFake(async function (this: LanguageClient) {
            startEntered.resolve(this);
            await startFinished.promise;
            await originalStart.call(this);
        });
        const traceStub = sandbox.stub(LanguageClient.prototype, 'setTrace').callsFake(() => {
            traceEntered.resolve();
            return traceFinished.promise;
        });
        const listenerSpy = sandbox.spy(LanguageClient.prototype, 'onDidChangeState');
        const restarting = restartServer(makeRestartOptions());
        let result: RestartServerResult | undefined;

        try {
            const client = await startEntered.promise;
            sinon.assert.calledOnceWithExactly(updateStatusStub, undefined, LanguageStatusSeverity.Information, true);
            sinon.assert.notCalled(traceStub);
            sinon.assert.notCalled(listenerSpy);

            startFinished.resolve();
            await traceEntered.promise;
            assert.strictEqual(client.state, State.Running, 'mock start changes state without emitting an event');
            sinon.assert.calledOnceWithExactly(updateStatusStub, undefined, LanguageStatusSeverity.Information, true);
            sinon.assert.notCalled(listenerSpy);

            traceFinished.resolve();
            result = await restarting;
            assert.strictEqual(result.client, client);
            assert.lengthOf(result.disposables, 1);
            assert.strictEqual(updateStatusStub.callCount, 2, 'success must explicitly clear busy without a state event');
            assert.deepEqual(updateStatusStub.lastCall.args, [undefined, LanguageStatusSeverity.Information, false]);
            sinon.assert.calledOnce(listenerSpy);
            sinon.assert.callOrder(startStub, traceStub, listenerSpy);
            assert.isTrue(updateStatusStub.lastCall.calledBefore(listenerSpy.firstCall));

            const mockClient = client as unknown as import('./_languageclient_mock').LanguageClient;
            mockClient.simulateStateChange(State.Stopped);
            assert.strictEqual(updateStatusStub.callCount, 2);
            mockClient.simulateStateChange(State.Running);
            assert.strictEqual(updateStatusStub.callCount, 3, 'returned listener should report future Running events');
            assert.deepEqual(updateStatusStub.lastCall.args, [undefined, LanguageStatusSeverity.Information, false]);

            result.disposables.forEach((disposable) => disposable.dispose());
            mockClient.simulateStateChange(State.Stopped);
            mockClient.simulateStateChange(State.Running);
            assert.strictEqual(updateStatusStub.callCount, 3, 'disposed listener must no longer update status');
        } finally {
            startFinished.resolve();
            traceFinished.resolve();
            result ??= await restarting;
            disposeResult(result);
        }
    });

    test('reports creation failure without starting a client or installing a listener', async () => {
        const startSpy = sandbox.spy(LanguageClient.prototype, 'start');
        const traceSpy = sandbox.spy(LanguageClient.prototype, 'setTrace');
        const listenerSpy = sandbox.spy(LanguageClient.prototype, 'onDidChangeState');
        (envFileModule.getEnvFileVars as sinon.SinonStub).rejects(new Error('env file failed'));
        const result = await restartServer(makeRestartOptions());

        try {
            assert.isUndefined(result.client);
            assert.isEmpty(result.disposables);
            assert.strictEqual(updateStatusStub.callCount, 2);
            assert.deepEqual(updateStatusStub.firstCall.args, [undefined, LanguageStatusSeverity.Information, true]);
            assert.strictEqual(updateStatusStub.lastCall.args[1], LanguageStatusSeverity.Error);
            assert.isFalse(updateStatusStub.calledWith(undefined, LanguageStatusSeverity.Information, false));
            sinon.assert.notCalled(startSpy);
            sinon.assert.notCalled(traceSpy);
            sinon.assert.notCalled(listenerSpy);
        } finally {
            disposeResult(result);
        }
    });

    for (const phase of ['start', 'setTrace'] as const) {
        test(`reports ${phase} rejection and disposes the client without installing a listener`, async () => {
            const entered = deferred<LanguageClient>();
            const finished = deferred<void>();
            sandbox.stub(LanguageClient.prototype, phase).callsFake(async function (this: LanguageClient) {
                entered.resolve(this);
                await finished.promise;
                throw new Error(`${phase} failed`);
            });
            const traceSpy = phase === 'start' ? sandbox.spy(LanguageClient.prototype, 'setTrace') : undefined;
            const disposeSpy = sandbox.spy(LanguageClient.prototype, 'dispose');
            const listenerSpy = sandbox.spy(LanguageClient.prototype, 'onDidChangeState');
            const restarting = restartServer(makeRestartOptions());
            let result: RestartServerResult | undefined;
            let client: LanguageClient | undefined;

            try {
                client = await entered.promise;
                sinon.assert.calledOnceWithExactly(updateStatusStub, undefined, LanguageStatusSeverity.Information, true);
                sinon.assert.notCalled(disposeSpy);
                sinon.assert.notCalled(listenerSpy);

                finished.resolve();
                result = await restarting;
                assert.isUndefined(result.client);
                assert.isEmpty(result.disposables);
                assert.strictEqual(updateStatusStub.lastCall.args[1], LanguageStatusSeverity.Error);
                assert.isFalse(updateStatusStub.calledWith(undefined, LanguageStatusSeverity.Information, false));
                sinon.assert.calledOnce(disposeSpy);
                sinon.assert.calledOn(disposeSpy, client);
                sinon.assert.notCalled(listenerSpy);
                if (traceSpy) {
                    sinon.assert.notCalled(traceSpy);
                }
            } finally {
                finished.resolve();
                result ??= await restarting;
                disposeResult(result);
                client?.dispose();
            }
        });
    }

    test('uses supplied extension settings without resolving them again', async () => {
        const extensionSettings = [
            makeSettings({ workspace: 'file:///workspace/project', interpreter: ['/project/python'] }),
        ];
        const globalSettings = makeSettings({
            workspace: process.cwd(),
            importStrategy: 'fromEnvironment',
            args: ['--global'],
        });
        (settingsModule.getGlobalSettings as sinon.SinonStub).resolves(globalSettings);

        const result = await restartServer(makeRestartOptions({ extensionSettings }));

        assert.isFalse(
            (settingsModule.getExtensionSettings as sinon.SinonStub).called,
            'pre-resolved settings should be reused',
        );
        const clientOptions = (result.client as unknown as {
            clientOptions: { initializationOptions: IInitOptions };
        }).clientOptions;
        assert.strictEqual(clientOptions.initializationOptions.settings, extensionSettings);
        assert.deepEqual(clientOptions.initializationOptions, {
            settings: extensionSettings,
            globalSettings,
        });
    });
});
