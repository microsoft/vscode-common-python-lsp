// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient } from 'vscode-languageclient/node';
import { State } from 'vscode-languageclient';
import {
    createToolContext,
    CreateToolContextOptions,
    deactivateServer,
    registerCommonSubscriptions,
    RegisterSubscriptionsOptions,
    ToolExtensionContext,
} from '../src/activation';
import * as configWatcher from '../src/configWatcher';
import * as settingsModule from '../src/settings';
import * as serverModule from '../src/server';
import * as statusModule from '../src/status';
import { IServerInfo, ToolConfig } from '../src/types';
import { PythonEnvironmentsProvider } from '../src/python';
import * as utilities from '../src/utilities';
import * as vscodeapi from '../src/vscodeapi';

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

function makeToolConfig(overrides?: Partial<ToolConfig>): ToolConfig {
    return {
        toolId: 'flake8',
        toolDisplayName: 'Flake8',
        toolModule: 'flake8',
        minimumPythonVersion: { major: 3, minor: 10 },
        configFiles: ['.flake8', 'setup.cfg'],
        settingsDefaults: {},
        trackedSettings: ['args', 'path'],
        serverScript: '/path/to/server.py',
        ...overrides,
    };
}

function makeServerInfo(): IServerInfo {
    return { name: 'Flake8', module: 'flake8' };
}

function makeMockOutputChannel(): vscode.LogOutputChannel {
    return {
        logLevel: vscode.LogLevel.Info,
        show: sinon.stub(),
        onDidChangeLogLevel: sinon.stub().returns({ dispose: sinon.stub() }),
    } as unknown as vscode.LogOutputChannel;
}

function makeMockProvider(sandbox: sinon.SinonSandbox): PythonEnvironmentsProvider {
    return {
        getInterpreterDetails: sandbox.stub().resolves({ path: ['/usr/bin/python3'] }),
        getDebuggerPath: sandbox.stub().resolves(undefined),
        initializePython: sandbox.stub().resolves(),
        subscribeToPackageChanges: sandbox.stub().resolves(undefined),
        getPythonProjects: sandbox.stub().resolves([]),
        onDidChangeInterpreter: sinon.stub().returns({ dispose: sinon.stub() }),
    } as unknown as PythonEnvironmentsProvider;
}

// ---------------------------------------------------------------------------
// createToolContext
// ---------------------------------------------------------------------------

suite('createToolContext', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(utilities, 'getProjectRoot').resolves(undefined);
        sandbox.stub(utilities, 'getInterpreterFromSetting').returns(['/usr/bin/python3']);
        sandbox.stub(settingsModule, 'getWorkspaceSettings').resolves({
            cwd: '/workspace',
            workspace: 'file:///workspace',
            args: [],
            path: [],
            interpreter: ['/usr/bin/python3'],
            importStrategy: 'useBundled',
            showNotifications: 'off',
        });
        sandbox.stub(serverModule, 'restartServer').resolves({ client: undefined, disposables: [] });
    });

    teardown(() => {
        sandbox.restore();
    });

    function makeOptions(overrides?: Partial<CreateToolContextOptions>): CreateToolContextOptions {
        return {
            serverInfo: makeServerInfo(),
            outputChannel: makeMockOutputChannel(),
            toolConfig: makeToolConfig(),
            pythonProvider: makeMockProvider(sandbox),
            ...overrides,
        };
    }

    test('returns a ToolExtensionContext with expected shape', () => {
        const ctx = createToolContext(makeOptions());
        assert.isDefined(ctx);
        assert.isUndefined(ctx.lsClient);
        assert.isFunction(ctx.runServer);
        assert.isFunction(ctx.initialize);
        assert.isFunction(ctx.dispose);
    });

    test('runServer calls restartServer when interpreter is present', async () => {
        const ctx = createToolContext(makeOptions());
        await ctx.runServer();
        assert.isTrue((serverModule.restartServer as sinon.SinonStub).calledOnce);
    });

    test('uses a project interpreter to bootstrap per-project mode', async () => {
        const root = {
            uri: vscode.Uri.file(path.dirname(process.cwd())),
            name: 'workspace',
            index: 0,
        };
        const project = {
            uri: vscode.Uri.file(process.cwd()),
            name: 'project',
            index: 0,
        };
        (utilities.getProjectRoot as sinon.SinonStub).resolves(root);
        sandbox.stub(vscodeapi, 'getConfiguration').returns({
            get: (key: string, defaultValue?: unknown) =>
                key === 'usePerProjectEnvironments' ? true : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        sandbox.stub(vscodeapi, 'getWorkspaceFolders').returns([root]);
        sandbox.stub(vscodeapi, 'getWorkspaceFolder').returns(root);
        const provider = makeMockProvider(sandbox);
        (provider.getPythonProjects as sinon.SinonStub).resolves([project]);
        const extensionSettings = [
            {
                cwd: '/workspace',
                workspace: root.uri.toString(),
                args: [],
                path: [],
                interpreter: [],
                importStrategy: 'useBundled',
                showNotifications: 'off',
            },
            {
                cwd: '/workspace',
                workspace: project.uri.toString(),
                args: [],
                path: [],
                interpreter: ['/project/python'],
                importStrategy: 'useBundled',
                showNotifications: 'off',
            },
        ];
        sandbox.stub(settingsModule, 'getExtensionSettings').resolves(extensionSettings);

        const ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );
        await ctx.runServer();

        const restartOptions = (serverModule.restartServer as sinon.SinonStub).firstCall.args[0];
        assert.strictEqual(restartOptions.settings, extensionSettings[1]);
        assert.strictEqual(restartOptions.extensionSettings, extensionSettings);
        assert.isTrue((settingsModule.getWorkspaceSettings as sinon.SinonStub).notCalled);
    });

    test('includes file-backed Python projects in per-project settings', async () => {
        const root = {
            uri: vscode.Uri.file(path.dirname(__filename)),
            name: 'workspace',
            index: 0,
        };
        const project = {
            uri: vscode.Uri.file(__filename),
            name: 'script',
            index: 0,
        };
        (utilities.getProjectRoot as sinon.SinonStub).resolves(root);
        sandbox.stub(vscodeapi, 'getConfiguration').returns({
            get: (key: string, defaultValue?: unknown) =>
                key === 'usePerProjectEnvironments' ? true : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        sandbox.stub(vscodeapi, 'getWorkspaceFolders').returns([root]);
        sandbox.stub(vscodeapi, 'getWorkspaceFolder').returns(root);
        const provider = makeMockProvider(sandbox);
        (provider.getPythonProjects as sinon.SinonStub).resolves([project]);
        sandbox.stub(settingsModule, 'getExtensionSettings').callsFake(async (_serverId, _toolConfig, _resolve, roots) => {
            assert.isDefined(roots);
            return roots!.map((workspace: vscode.WorkspaceFolder) => ({
                cwd: root.uri.fsPath,
                workspace: workspace.uri.toString(),
                args: [],
                path: [],
                interpreter: ['/project/python'],
                importStrategy: 'useBundled',
                showNotifications: 'off',
            }));
        });

        const ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );
        await ctx.runServer();

        const restartOptions = (serverModule.restartServer as sinon.SinonStub).firstCall.args[0];
        assert.deepEqual(
            restartOptions.extensionSettings.map((settings: { workspace: string }) => settings.workspace),
            [root.uri.toString(), project.uri.toString()],
        );
    });

    test('runServer reports missing interpreter when none configured', async () => {
        (settingsModule.getWorkspaceSettings as sinon.SinonStub).resolves({
            cwd: '/workspace',
            workspace: 'file:///workspace',
            args: [],
            path: [],
            interpreter: [],
            importStrategy: 'useBundled',
            showNotifications: 'off',
        });
        const updateStatusStub = sandbox.stub(statusModule, 'updateStatus');

        const ctx = createToolContext(makeOptions());
        await ctx.runServer();

        assert.isTrue(updateStatusStub.called, 'should update status with error');
        assert.isFalse(
            (serverModule.restartServer as sinon.SinonStub).called,
            'should not call restartServer',
        );
    });

    test('runServer stops stale client when interpreter is cleared', async () => {
        const stopStub = sandbox.stub().resolves();
        const mockClient = { stop: stopStub } as unknown as import('vscode-languageclient/node').LanguageClient;

        // First run succeeds — sets up a client
        (serverModule.restartServer as sinon.SinonStub).resolves({ client: mockClient, disposables: [] });
        const ctx = createToolContext(makeOptions());
        await ctx.runServer();
        assert.strictEqual(ctx.lsClient, mockClient);

        // Now interpreter is cleared
        (settingsModule.getWorkspaceSettings as sinon.SinonStub).resolves({
            cwd: '/workspace',
            workspace: 'file:///workspace',
            args: [],
            path: [],
            interpreter: [],
            importStrategy: 'useBundled',
            showNotifications: 'off',
        });

        await ctx.runServer();
        assert.isTrue(stopStub.calledOnce, 'should stop the stale client');
        assert.isUndefined(ctx.lsClient, 'client should be cleared');
    });

    test('dispose during in-flight restart cleans up late results and cancels queued retry', async () => {
        const clock = sandbox.useFakeTimers();
        const entered = deferred<void>();
        const finished = deferred<serverModule.RestartServerResult>();
        const restartStub = serverModule.restartServer as sinon.SinonStub;
        restartStub.callsFake(() => {
            entered.resolve();
            return finished.promise;
        });
        const stop = sandbox.stub().resolves();
        const dispose = sandbox.stub();
        const listener = { dispose: sandbox.stub() };
        const result = {
            client: { stop, dispose } as unknown as LanguageClient,
            disposables: [listener],
        };
        const ctx = createToolContext(makeOptions({ toolConfig: makeToolConfig({ restartDelay: 50 }) }));
        const running = ctx.runServer();

        try {
            await entered.promise;
            await ctx.runServer();
            assert.strictEqual(clock.countTimers(), 1, 'overlap should queue a retry');

            ctx.dispose();
            assert.strictEqual(clock.countTimers(), 0, 'dispose should cancel the retry timer');
            finished.resolve(result);
            await running;

            assert.isUndefined(ctx.lsClient, 'should not assign the late client');
            sinon.assert.calledOnce(stop);
            sinon.assert.calledOnce(dispose);
            sinon.assert.calledOnce(listener.dispose);

            await ctx.runServer();
            await clock.tickAsync(100);
            sinon.assert.calledOnce(restartStub);
            assert.isUndefined(ctx.lsClient, 'calls and timers must not resurrect the context');
        } finally {
            ctx.dispose();
            finished.resolve(result);
            await running;
        }
    });

    test('overlapping runServer calls acknowledge scheduling and reset a single trailing retry', async () => {
        const clock = sandbox.useFakeTimers();
        const entered = deferred<void>();
        const finished = deferred<serverModule.RestartServerResult>();
        const restartStub = serverModule.restartServer as sinon.SinonStub;
        const firstClient = new LanguageClient('first', 'First', { command: 'python' }, {});
        const secondClient = new LanguageClient('second', 'Second', { command: 'python' }, {});
        const firstResult = { client: firstClient, disposables: [] };
        restartStub.onFirstCall().callsFake(() => {
            entered.resolve();
            return finished.promise;
        });
        restartStub.onSecondCall().resolves({ client: secondClient, disposables: [] });
        const ctx = createToolContext(makeOptions({ toolConfig: makeToolConfig({ restartDelay: 50 }) }));
        let firstSettled = false;
        const first = ctx.runServer().then(() => {
            firstSettled = true;
        });

        try {
            await entered.promise;
            await ctx.runServer();
            assert.isFalse(firstSettled, 'overlap resolves without waiting for the active restart');
            assert.isUndefined(ctx.lsClient);
            sinon.assert.calledOnce(restartStub);

            await clock.tickAsync(30);
            await ctx.runServer();
            assert.isFalse(firstSettled);
            assert.strictEqual(clock.countTimers(), 1, 'overlaps should replace, not accumulate, timers');

            await clock.tickAsync(20);
            sinon.assert.calledOnce(restartStub);
            await ctx.runServer();
            assert.strictEqual(clock.countTimers(), 1);
            await clock.tickAsync(30);
            sinon.assert.calledOnce(restartStub);
            await clock.tickAsync(19);
            sinon.assert.calledOnce(restartStub);
            assert.isFalse(firstSettled, 'the active restart is still held at the reset trailing edge');

            await clock.tickAsync(1);
            sinon.assert.calledOnce(restartStub);
            assert.strictEqual(clock.countTimers(), 1, 'a retry during an active restart should be rescheduled');
            assert.isFalse(firstSettled);

            finished.resolve(firstResult);
            await first;
            assert.strictEqual(ctx.lsClient, firstClient);

            await clock.tickAsync(49);
            sinon.assert.calledOnce(restartStub);
            await clock.tickAsync(1);
            sinon.assert.calledTwice(restartStub);
            assert.strictEqual(restartStub.secondCall.args[1], firstClient);
            assert.strictEqual(ctx.lsClient, secondClient);

            await clock.tickAsync(100);
            sinon.assert.calledTwice(restartStub);
        } finally {
            ctx.dispose();
            finished.resolve(firstResult);
            await first;
            firstClient.dispose();
            secondClient.dispose();
        }
    });

    test('initialize starts server when interpreter is already set', async () => {
        const ctx = createToolContext(makeOptions());
        await ctx.initialize([]);

        assert.isTrue(
            (serverModule.restartServer as sinon.SinonStub).calledOnce,
            'should start server immediately',
        );
    });

    test('initializes project events even when the interpreter is pinned', async () => {
        (utilities.getProjectRoot as sinon.SinonStub).resolves({
            uri: vscode.Uri.file('/workspace'),
            name: 'workspace',
            index: 0,
        });
        sandbox.stub(vscodeapi, 'getConfiguration').returns({
            get: (key: string, defaultValue?: unknown) =>
                key === 'usePerProjectEnvironments' ? true : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );

        await ctx.initialize([]);

        assert.isTrue((provider.initializePython as sinon.SinonStub).calledOnce);
        assert.isFalse((provider.initializePython as sinon.SinonStub).firstCall.args[2]);
        assert.isTrue((serverModule.restartServer as sinon.SinonStub).calledOnce);
    });

    test('does not initialize project events when per-project mode is disabled', async () => {
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );

        await ctx.initialize([]);

        assert.isFalse((provider.initializePython as sinon.SinonStub).called);
        assert.isTrue((serverModule.restartServer as sinon.SinonStub).calledOnce);
    });

    test('initializes project events when per-project mode is enabled later', async () => {
        let enabled = false;
        sandbox.stub(vscodeapi, 'getConfiguration').returns({
            get: (key: string, defaultValue?: unknown) =>
                key === 'usePerProjectEnvironments' ? enabled : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );
        await ctx.initialize([]);
        assert.isFalse((provider.initializePython as sinon.SinonStub).called);

        enabled = true;
        await ctx.runServer();

        assert.isTrue((provider.initializePython as sinon.SinonStub).calledOnce);
        assert.isFalse((provider.initializePython as sinon.SinonStub).firstCall.args[2]);
    });

    test('does not initialize Python recursively when the initial refresh triggers a restart', async () => {
        (utilities.getInterpreterFromSetting as sinon.SinonStub).returns(undefined);
        sandbox.stub(vscodeapi, 'getConfiguration').returns({
            get: (key: string, defaultValue?: unknown) =>
                key === 'usePerProjectEnvironments' ? true : defaultValue,
        } as unknown as vscode.WorkspaceConfiguration);
        const provider = makeMockProvider(sandbox);
        let ctx: ToolExtensionContext;
        (provider.initializePython as sinon.SinonStub).callsFake(async () => ctx.runServer());
        ctx = createToolContext(
            makeOptions({
                toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
                pythonProvider: provider,
            }),
        );

        await ctx.initialize([]);

        assert.isTrue((provider.initializePython as sinon.SinonStub).calledOnce);
    });

    test('initialize defers to Python extension when no interpreter set', async () => {
        (utilities.getInterpreterFromSetting as sinon.SinonStub).returns(undefined);
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(makeOptions({ pythonProvider: provider }));
        await ctx.initialize([]);

        assert.isTrue(
            (provider.initializePython as sinon.SinonStub).calledOnce,
            'should call initializePython',
        );
        assert.isFalse(
            (serverModule.restartServer as sinon.SinonStub).called,
            'should not call restartServer directly',
        );
    });

    test('subscribes to package changes and debounces bursts at the reset trailing edge', async () => {
        const clock = sandbox.useFakeTimers();
        (utilities.getInterpreterFromSetting as sinon.SinonStub).returns(undefined);
        const provider = makeMockProvider(sandbox);

        let capturedHandler: (() => void) | undefined;
        const disposeStub = sandbox.stub();
        (provider.subscribeToPackageChanges as sinon.SinonStub).callsFake((handler: () => void) => {
            capturedHandler = handler;
            return Promise.resolve({ dispose: disposeStub });
        });
        const entered = deferred<void>();
        const restartStub = serverModule.restartServer as sinon.SinonStub;
        restartStub.callsFake(() => {
            entered.resolve();
            return Promise.resolve({ client: undefined, disposables: [] });
        });
        const subscriptions: vscode.Disposable[] = [];
        const ctx = createToolContext(
            makeOptions({
                pythonProvider: provider,
                toolConfig: makeToolConfig({ refreshExtensionOnPackagesChange: true, restartDelay: 50 }),
            }),
        );
        const runSpy = sandbox.spy(ctx, 'runServer');

        try {
            await ctx.initialize(subscriptions);
            sinon.assert.calledOnce(provider.subscribeToPackageChanges as sinon.SinonStub);
            assert.isFunction(capturedHandler);
            assert.lengthOf(subscriptions, 1, 'subscription belongs to the extension');

            capturedHandler!();
            await clock.tickAsync(30);
            capturedHandler!();
            await clock.tickAsync(20);
            sinon.assert.notCalled(restartStub);
            await clock.tickAsync(29);
            sinon.assert.notCalled(restartStub);

            await clock.tickAsync(1);
            await entered.promise;
            await runSpy.firstCall.returnValue;
            sinon.assert.calledOnce(restartStub);

            await clock.tickAsync(100);
            sinon.assert.calledOnce(restartStub);
        } finally {
            ctx.dispose();
            subscriptions.forEach((subscription) => subscription.dispose());
            if (runSpy.called) {
                await runSpy.firstCall.returnValue;
            }
        }
    });

    test('dispose cancels pending package refresh and ignores later package events', async () => {
        const clock = sandbox.useFakeTimers();
        const provider = makeMockProvider(sandbox);
        const restartStub = serverModule.restartServer as sinon.SinonStub;
        const ctx = createToolContext(
            makeOptions({
                pythonProvider: provider,
                toolConfig: makeToolConfig({ refreshExtensionOnPackagesChange: true, restartDelay: 50 }),
            }),
        );

        try {
            await ctx.initialize([]);
            const handler = (provider.subscribeToPackageChanges as sinon.SinonStub)
                .firstCall.args[0] as () => void;
            sinon.assert.calledOnce(restartStub);

            handler();
            await clock.tickAsync(25);
            assert.strictEqual(clock.countTimers(), 1);
            ctx.dispose();
            assert.strictEqual(clock.countTimers(), 0, 'dispose should cancel package debounce');

            await clock.tickAsync(100);
            handler();
            assert.strictEqual(clock.countTimers(), 0, 'late package events must not schedule work');
            await clock.tickAsync(100);
            sinon.assert.calledOnce(restartStub);
        } finally {
            ctx.dispose();
        }
    });

    test('subscribes to package changes even when the interpreter is pinned via setting', async () => {
        (utilities.getInterpreterFromSetting as sinon.SinonStub).returns(['/usr/bin/python3']);
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(
            makeOptions({
                pythonProvider: provider,
                toolConfig: makeToolConfig({ refreshExtensionOnPackagesChange: true }),
            }),
        );
        await ctx.initialize([]);

        assert.isFalse(
            (provider.initializePython as sinon.SinonStub).called,
            'pinned interpreter path should skip initializePython',
        );
        assert.isTrue(
            (provider.subscribeToPackageChanges as sinon.SinonStub).calledOnce,
            'should still wire the package-change subscription when pinned',
        );
    });

    test('does not subscribe to package changes when refreshExtensionOnPackagesChange is disabled', async () => {
        (utilities.getInterpreterFromSetting as sinon.SinonStub).returns(undefined);
        const provider = makeMockProvider(sandbox);
        const ctx = createToolContext(makeOptions({ pythonProvider: provider }));
        await ctx.initialize([]);

        assert.isFalse(
            (provider.subscribeToPackageChanges as sinon.SinonStub).called,
            'should not subscribe when the option is disabled',
        );
    });

    test('dispose prevents further runServer calls', async () => {
        const ctx = createToolContext(makeOptions());
        ctx.dispose();
        await ctx.runServer();
        assert.isFalse(
            (serverModule.restartServer as sinon.SinonStub).called,
            'should not call restartServer after dispose',
        );
    });
});

// ---------------------------------------------------------------------------
// registerCommonSubscriptions
// ---------------------------------------------------------------------------

suite('registerCommonSubscriptions', () => {
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;
    let subscriptions: vscode.Disposable[];

    setup(() => {
        sandbox = sinon.createSandbox();
        subscriptions = [];
        context = { subscriptions } as unknown as vscode.ExtensionContext;

        sandbox.stub(vscodeapi, 'registerCommand').returns({ dispose: sinon.stub() });
        sandbox.stub(vscodeapi, 'onDidChangeConfiguration').returns({ dispose: sinon.stub() });
        sandbox.stub(statusModule, 'registerLanguageStatusItem').returns({ dispose: sinon.stub() });
        sandbox.stub(configWatcher, 'createConfigFileWatchers').returns([{ dispose: sinon.stub() }]);
    });

    teardown(() => {
        sandbox.restore();
    });

    function makeRegisterOptions(overrides?: Partial<RegisterSubscriptionsOptions>): RegisterSubscriptionsOptions {
        return {
            serverInfo: makeServerInfo(),
            outputChannel: makeMockOutputChannel(),
            toolConfig: makeToolConfig(),
            toolContext: {
                lsClient: undefined,
                runServer: sandbox.stub().resolves(),
                initialize: sandbox.stub().resolves(),
                dispose: sandbox.stub(),
            },
            pythonProvider: makeMockProvider(sandbox),
            ...overrides,
        };
    }

    test('registers subscriptions into context', () => {
        registerCommonSubscriptions(context, makeRegisterOptions());
        // Should have: 2 log level + 1 interpreter + 2 commands + 1 config + 1 status + watchers
        assert.isAbove(subscriptions.length, 5, 'should register multiple subscriptions');
    });

    test('registers showLogs and restart commands', () => {
        registerCommonSubscriptions(context, makeRegisterOptions());
        const registerCmd = vscodeapi.registerCommand as sinon.SinonStub;
        const commands = registerCmd.args.map((call: unknown[]) => call[0]);
        assert.include(commands, 'flake8.showLogs');
        assert.include(commands, 'flake8.restart');
    });

    test('registers language status item', () => {
        registerCommonSubscriptions(context, makeRegisterOptions());
        assert.isTrue(
            (statusModule.registerLanguageStatusItem as sinon.SinonStub).calledWith(
                'flake8',
                'Flake8',
                'flake8.showLogs',
            ),
        );
    });

    test('creates config file watchers from toolConfig', () => {
        const config = makeToolConfig({ configFiles: ['.flake8', 'setup.cfg', 'tox.ini'] });
        registerCommonSubscriptions(context, makeRegisterOptions({ toolConfig: config }));
        const createWatchers = configWatcher.createConfigFileWatchers as sinon.SinonStub;
        assert.isTrue(createWatchers.calledOnce);
        assert.deepEqual(createWatchers.firstCall.args[0], ['.flake8', 'setup.cfg', 'tox.ini']);
    });

    test('registers configuration change listener', () => {
        registerCommonSubscriptions(context, makeRegisterOptions());
        assert.isTrue(
            (vscodeapi.onDidChangeConfiguration as sinon.SinonStub).calledOnce,
        );
    });

    test('tracks the per-project setting for opted-in tools', async () => {
        let configurationHandler:
            | ((event: vscode.ConfigurationChangeEvent) => Promise<void>)
            | undefined;
        (vscodeapi.onDidChangeConfiguration as sinon.SinonStub).callsFake(
            (handler: (event: vscode.ConfigurationChangeEvent) => Promise<void>) => {
                configurationHandler = handler;
                return { dispose: sinon.stub() };
            },
        );
        const options = makeRegisterOptions({
            toolConfig: makeToolConfig({ supportsPerProjectEnvironments: true }),
        });
        registerCommonSubscriptions(context, options);

        await configurationHandler?.({
            affectsConfiguration: (setting: string) =>
                setting === 'flake8.usePerProjectEnvironments',
        } as vscode.ConfigurationChangeEvent);

        assert.isTrue((options.toolContext.runServer as sinon.SinonStub).calledOnce);
    });
});

// ---------------------------------------------------------------------------
// deactivateServer
// ---------------------------------------------------------------------------

suite('deactivateServer', () => {
    test('disposes context before awaiting client stop', async () => {
        const entered = deferred<void>();
        const finished = deferred<void>();
        const stop = sinon.stub().callsFake(() => {
            entered.resolve();
            return finished.promise;
        });
        const dispose = sinon.stub();
        const client = { stop } as unknown as LanguageClient;
        const ctx: ToolExtensionContext = {
            lsClient: client,
            runServer: sinon.stub().resolves(),
            initialize: sinon.stub().resolves(),
            dispose,
        };
        let deactivated = false;
        const pending = deactivateServer(ctx).then(() => {
            deactivated = true;
        });
        try {
            await entered.promise;
            sinon.assert.calledOnce(stop);
            sinon.assert.calledOnce(dispose);
            sinon.assert.callOrder(dispose, stop);
            assert.isFalse(deactivated, 'deactivation must wait for the already-assigned client to stop');

            finished.resolve();
            await pending;
            assert.isTrue(deactivated);
        } finally {
            finished.resolve();
            await pending;
        }
    });

    test('handles undefined context', async () => {
        await deactivateServer(undefined);
    });

    test('handles client stop failure gracefully', async () => {
        const dispose = sinon.stub();
        const client = {
            stop: sinon.stub().rejects(new Error('stop failed')),
        } as unknown as LanguageClient;
        const ctx: ToolExtensionContext = {
            lsClient: client,
            runServer: sinon.stub().resolves(),
            initialize: sinon.stub().resolves(),
            dispose,
        };
        await deactivateServer(ctx);
        assert.isTrue(dispose.calledOnce, 'dispose should still be called');
    });

    test('disposes context even without client', async () => {
        const dispose = sinon.stub();
        const ctx: ToolExtensionContext = {
            lsClient: undefined,
            runServer: sinon.stub().resolves(),
            initialize: sinon.stub().resolves(),
            dispose,
        };
        await deactivateServer(ctx);
        assert.isTrue(dispose.calledOnce);
    });
});

// ---------------------------------------------------------------------------
// NullFormatter lifecycle (via createToolContext with isFormatter: true)
// ---------------------------------------------------------------------------

suite('createToolContext – NullFormatter lifecycle', () => {
    let sandbox: sinon.SinonSandbox;
    let registerFormattingProviderStub: sinon.SinonStub;
    let providerDispose: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(utilities, 'getProjectRoot').resolves(undefined);
        sandbox.stub(utilities, 'getInterpreterFromSetting').returns(['/usr/bin/python3']);
        sandbox.stub(settingsModule, 'getWorkspaceSettings').resolves({
            cwd: '/workspace',
            workspace: 'file:///workspace',
            args: [],
            path: [],
            interpreter: ['/usr/bin/python3'],
            importStrategy: 'useBundled',
            showNotifications: 'off',
        });

        providerDispose = sandbox.stub();
        registerFormattingProviderStub = sandbox
            .stub(vscodeapi, 'registerDocumentFormattingEditProvider')
            .returns({ dispose: providerDispose });
    });

    teardown(() => {
        sandbox.restore();
    });

    function makeFormatterOptions(overrides?: Partial<CreateToolContextOptions>): CreateToolContextOptions {
        return {
            serverInfo: { name: 'Black', module: 'black' },
            outputChannel: {
                logLevel: vscode.LogLevel.Info,
                show: sinon.stub(),
                onDidChangeLogLevel: sinon.stub().returns({ dispose: sinon.stub() }),
            } as unknown as vscode.LogOutputChannel,
            toolConfig: {
                toolId: 'black',
                toolDisplayName: 'Black',
                toolModule: 'black',
                minimumPythonVersion: { major: 3, minor: 8 },
                configFiles: ['pyproject.toml'],
                settingsDefaults: {},
                trackedSettings: ['args'],
                serverScript: '/path/to/server.py',
                isFormatter: true,
            },
            pythonProvider: {
                getInterpreterDetails: sandbox.stub().resolves({ path: ['/usr/bin/python3'] }),
                getDebuggerPath: sandbox.stub().resolves(undefined),
                initializePython: sandbox.stub().resolves(),
                onDidChangeInterpreter: sinon.stub().returns({ dispose: sinon.stub() }),
            } as unknown as PythonEnvironmentsProvider,
            ...overrides,
        };
    }

    // Uses the shared LanguageClient mock from _languageclient_mock.ts
    // (wired in by _setup.ts) so production and test getter semantics
    // stay in sync.  At compile-time, LanguageClient resolves to the real
    // vscode-languageclient type; at runtime it is replaced by the mock
    // (which exposes simulateStateChange).  We import the mock type for
    // the helper return type so callers get proper type-checking.
    type MockClient = import('./_languageclient_mock').LanguageClient;

    function makeMockClient(initialState: State = State.Stopped): MockClient {
        const MockLC = LanguageClient as unknown as typeof import('./_languageclient_mock').LanguageClient;
        const client = new MockLC('test', 'Test', {}, {});
        // Drive the mock to the desired initial state.
        if (initialState !== State.Stopped) {
            client.simulateStateChange(initialState);
        }
        return client;
    }

    /** Cast a mock client to the real LanguageClient type for stub return values. */
    function asLC(mock: MockClient): LanguageClient {
        return mock as unknown as LanguageClient;
    }

    // Test 1: provider registered once at createToolContext, disposed on State.Running
    test('registers placeholder once at activation and disposes it on State.Running', async () => {
        const mockClient = makeMockClient(State.Stopped);
        sandbox.stub(serverModule, 'restartServer').resolves({ client: asLC(mockClient), disposables: [] });

        const ctx = createToolContext(makeFormatterOptions());

        assert.isTrue(registerFormattingProviderStub.calledOnce, 'provider registered at activation');
        assert.isFalse(providerDispose.called, 'not yet disposed before server starts');

        await ctx.runServer();

        // Client is Stopped — "already Running" guard does not fire
        assert.isFalse(providerDispose.called, 'not disposed before Running transition');

        // Emit Running — state listener should dispose the placeholder
        mockClient.simulateStateChange(State.Running);
        assert.isTrue(providerDispose.calledOnce, 'placeholder disposed on State.Running');
    });

    // Test 2: crash/recovery — server stops while running, placeholder restored
    test('re-registers placeholder on server crash (Stopped while running) and disposes on recovery', async () => {
        const mockClient = makeMockClient(State.Stopped);
        sandbox.stub(serverModule, 'restartServer').resolves({ client: asLC(mockClient), disposables: [] });

        const ctx = createToolContext(makeFormatterOptions());
        assert.isTrue(registerFormattingProviderStub.calledOnce, 'provider registered at activation');

        await ctx.runServer();

        // Simulate Running — placeholder disposed
        mockClient.simulateStateChange(State.Running);
        assert.strictEqual(providerDispose.callCount, 1, 'placeholder disposed on Running');

        // Simulate Stopped — placeholder re-registered
        mockClient.simulateStateChange(State.Stopped);
        assert.strictEqual(registerFormattingProviderStub.callCount, 2, 'placeholder re-registered on Stopped');

        // Simulate Starting — placeholder already registered, no double-registration
        mockClient.simulateStateChange(State.Starting);
        assert.strictEqual(registerFormattingProviderStub.callCount, 2, 'no double-registration on Starting');

        // Simulate Running again — placeholder disposed again
        mockClient.simulateStateChange(State.Running);
        assert.strictEqual(providerDispose.callCount, 2, 'placeholder disposed again on Running');
    });

    // Test 3: already-Running guard — client is Running when runServer() returns
    test('disposes placeholder immediately when client is already Running at runServer return', async () => {
        const mockClient = makeMockClient(State.Running);
        sandbox.stub(serverModule, 'restartServer').resolves({ client: asLC(mockClient), disposables: [] });

        const ctx = createToolContext(makeFormatterOptions());
        assert.isTrue(registerFormattingProviderStub.calledOnce, 'provider registered at activation');

        await ctx.runServer();

        assert.isTrue(
            providerDispose.calledOnce,
            'placeholder must be disposed even when client is already Running (missed initial transition)',
        );
    });

    // Test 4: isFormatter: false — no placeholder, no state listener
    test('does not register placeholder when isFormatter is false', async () => {
        const options = makeFormatterOptions();
        options.toolConfig = { ...options.toolConfig, isFormatter: false };
        sandbox.stub(serverModule, 'restartServer').resolves({ client: undefined, disposables: [] });

        createToolContext(options);

        assert.isFalse(
            registerFormattingProviderStub.called,
            'should not register provider when isFormatter is false',
        );
    });

    // Test 5: isFormatter unset — no placeholder
    test('does not register placeholder when isFormatter is unset', async () => {
        const options = makeFormatterOptions();
        const { isFormatter, ...configWithoutFormatter } = options.toolConfig;
        options.toolConfig = configWithoutFormatter as ToolConfig;
        sandbox.stub(serverModule, 'restartServer').resolves({ client: undefined, disposables: [] });

        createToolContext(options);

        assert.isFalse(
            registerFormattingProviderStub.called,
            'should not register provider when isFormatter is unset',
        );
    });

    // Test 6: ctx.dispose() disposes placeholder
    test('ctx.dispose() disposes the placeholder when it is registered', () => {
        const ctx = createToolContext(makeFormatterOptions());
        assert.isTrue(registerFormattingProviderStub.calledOnce, 'provider registered at activation');

        ctx.dispose();
        assert.isTrue(providerDispose.calledOnce, 'placeholder disposed on ctx.dispose()');
    });

    test('holds formatter fallback until replacement completes and ignores stale client events', async () => {
        const firstClient = makeMockClient(State.Stopped);
        const secondClient = makeMockClient(State.Stopped);
        const entered = deferred<void>();
        const finished = deferred<serverModule.RestartServerResult>();
        const replacement = { client: asLC(secondClient), disposables: [] };
        const restartStub = sandbox.stub(serverModule, 'restartServer');
        restartStub.onFirstCall().resolves({ client: asLC(firstClient), disposables: [] });
        restartStub.onSecondCall().callsFake(() => {
            entered.resolve();
            return finished.promise;
        });
        const ctx = createToolContext(makeFormatterOptions());
        let replacing: Promise<void> | undefined;

        try {
            await ctx.runServer();
            firstClient.simulateStateChange(State.Running);
            sinon.assert.calledOnce(providerDispose);

            replacing = ctx.runServer();
            await entered.promise;
            assert.strictEqual(firstClient.state, State.Running);
            assert.strictEqual(ctx.lsClient, asLC(firstClient));
            sinon.assert.calledOnce(registerFormattingProviderStub);
            sinon.assert.calledOnce(providerDispose);

            // The old listener is gone; fallback returns only at replacement completion.
            firstClient.simulateStateChange(State.Stopped);
            sinon.assert.calledOnce(registerFormattingProviderStub);

            finished.resolve(replacement);
            await replacing;
            assert.strictEqual(ctx.lsClient, asLC(secondClient));
            sinon.assert.calledTwice(registerFormattingProviderStub);

            firstClient.simulateStateChange(State.Running);
            sinon.assert.calledOnce(providerDispose);
            secondClient.simulateStateChange(State.Running);
            sinon.assert.calledTwice(providerDispose);
            firstClient.simulateStateChange(State.Stopped);
            sinon.assert.calledTwice(registerFormattingProviderStub);

            ctx.dispose();
            firstClient.simulateStateChange(State.Starting);
            secondClient.simulateStateChange(State.Stopped);
            secondClient.simulateStateChange(State.Running);
            sinon.assert.calledTwice(registerFormattingProviderStub);
            sinon.assert.calledTwice(providerDispose);
        } finally {
            ctx.dispose();
            finished.resolve(replacement);
            await replacing;
            firstClient.dispose();
            secondClient.dispose();
        }
    });

    // Test 8: restartServer returns no client — placeholder stays registered
    test('keeps placeholder registered when restartServer returns no client', async () => {
        sandbox.stub(serverModule, 'restartServer').resolves({ client: undefined, disposables: [] });

        const ctx = createToolContext(makeFormatterOptions());
        assert.strictEqual(registerFormattingProviderStub.callCount, 1, 'registered at activation');

        await ctx.runServer();

        // Placeholder should still be registered (register() called again at
        // top of runServer as a no-op, and never unregistered).
        assert.isFalse(providerDispose.called, 'placeholder must stay registered when no client');
    });
});
