// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
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

    test('dispose during in-flight restart prevents client assignment', async () => {
        let resolveRestart: ((value: unknown) => void) | undefined;
        (serverModule.restartServer as sinon.SinonStub).returns(
            new Promise((resolve) => {
                resolveRestart = resolve;
            }),
        );

        const ctx = createToolContext(makeOptions());
        const runPromise = ctx.runServer();

        // Dispose while restartServer is in-flight
        ctx.dispose();

        // Now resolve the restart — should NOT assign client
        const mockClient = { stop: sandbox.stub().resolves(), dispose: sandbox.stub() };
        resolveRestart!({ client: mockClient, disposables: [] });
        await runPromise;

        assert.isUndefined(ctx.lsClient, 'should not assign client after dispose');
    });

    test('runServer debounces rapid calls', async () => {
        const clock = sandbox.useFakeTimers();
        const restartServerStub = serverModule.restartServer as sinon.SinonStub;
        const ctx = createToolContext(makeOptions({ toolConfig: makeToolConfig({ restartDelay: 50 }) }));

        // First call triggers. isRestarting is set synchronously.
        const p1 = ctx.runServer();
        // Second call while first is in progress — hits isRestarting, schedules timer.
        const p2 = ctx.runServer();

        // p2 resolves immediately (debounced path returns early).
        await p2;

        // Complete the first call (flushes all internal awaits).
        await p1;
        assert.isTrue(restartServerStub.calledOnce, 'first call should trigger restartServer');

        // Tick past the debounce delay — the scheduled timer should fire.
        await clock.tickAsync(50);
        assert.isTrue(restartServerStub.calledTwice, 'debounced call should trigger restartServer after delay');

        clock.restore();
    });

    test('initialize starts server when interpreter is already set', async () => {
        const ctx = createToolContext(makeOptions());
        await ctx.initialize([]);

        assert.isTrue(
            (serverModule.restartServer as sinon.SinonStub).calledOnce,
            'should start server immediately',
        );
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
});

// ---------------------------------------------------------------------------
// deactivateServer
// ---------------------------------------------------------------------------

suite('deactivateServer', () => {
    test('stops the client and disposes context', async () => {
        const stop = sinon.stub().resolves();
        const dispose = sinon.stub();
        const client = { stop } as unknown as LanguageClient;
        const ctx: ToolExtensionContext = {
            lsClient: client,
            runServer: sinon.stub().resolves(),
            initialize: sinon.stub().resolves(),
            dispose,
        };
        await deactivateServer(ctx);
        assert.isTrue(stop.calledOnce);
        assert.isTrue(dispose.calledOnce);
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
