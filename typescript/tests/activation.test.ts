// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
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
        onDidChangePackages: sinon.stub().returns({ dispose: sinon.stub() }),
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

    test('subscribes to package change events when refreshOnPackageChange is enabled', () => {
        const options = makeRegisterOptions({ toolConfig: makeToolConfig({ refreshOnPackageChange: true }) });
        registerCommonSubscriptions(context, options);
        const onDidChangePackages = options.pythonProvider.onDidChangePackages as unknown as sinon.SinonStub;
        assert.isTrue(onDidChangePackages.calledOnce, 'should subscribe to package change events');
    });

    test('does not subscribe to package change events when refreshOnPackageChange is disabled', () => {
        const options = makeRegisterOptions();
        registerCommonSubscriptions(context, options);
        const onDidChangePackages = options.pythonProvider.onDidChangePackages as unknown as sinon.SinonStub;
        assert.isFalse(onDidChangePackages.called, 'should not subscribe to package change events');
    });

    test('restarts server on package change when refreshOnPackageChange is enabled', async () => {
        const options = makeRegisterOptions({ toolConfig: makeToolConfig({ refreshOnPackageChange: true }) });
        registerCommonSubscriptions(context, options);

        const onDidChangePackages = options.pythonProvider.onDidChangePackages as unknown as sinon.SinonStub;
        const handler = onDidChangePackages.firstCall.args[0] as () => Promise<void>;
        await handler();

        assert.isTrue(
            (options.toolContext.runServer as sinon.SinonStub).called,
            'runServer should be called on package change when enabled',
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
                onDidChangePackages: sinon.stub().returns({ dispose: sinon.stub() }),
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

    // Test 7: extension-driven restart — second runServer() is called while
    // the first client is still Running.  The guard at the top of runServer
    // skips re-registration to avoid the transient duplicate-formatter issue.
    // The placeholder is re-registered only after restartServer returns the
    // new (not-yet-Running) client.
    test('re-registers placeholder on extension-driven restart (second runServer call)', async () => {
        const firstClient = makeMockClient(State.Stopped);
        const secondClient = makeMockClient(State.Stopped);
        const restartStub = sandbox.stub(serverModule, 'restartServer');
        restartStub.onFirstCall().resolves({ client: asLC(firstClient), disposables: [] });
        restartStub.onSecondCall().resolves({ client: asLC(secondClient), disposables: [] });

        const ctx = createToolContext(makeFormatterOptions());
        assert.strictEqual(registerFormattingProviderStub.callCount, 1, 'registered at activation');

        // First run — transition to Running disposes placeholder
        await ctx.runServer();
        firstClient.simulateStateChange(State.Running);
        assert.strictEqual(providerDispose.callCount, 1, 'placeholder disposed after first Running');

        // Second runServer() — simulates config/interpreter-driven restart.
        // firstClient is still Running, so the guard at the top of runServer
        // skips register (avoiding transient duplicate).  After restartServer
        // returns the new client (Stopped), the placeholder is re-registered.
        await ctx.runServer();
        assert.strictEqual(
            registerFormattingProviderStub.callCount, 2,
            'placeholder re-registered after restartServer returns non-Running client',
        );

        // Transition second client to Running — placeholder disposed again
        secondClient.simulateStateChange(State.Running);
        assert.strictEqual(providerDispose.callCount, 2, 'placeholder disposed after second Running');
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
