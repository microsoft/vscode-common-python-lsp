// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PythonEnvironmentApi, PythonEnvironments } from '@vscode/python-environments';
import { LanguageClient } from 'vscode-languageclient/node';
import * as activation from '../src/activation';
import { registerLogger } from '../src/logging';
import { PythonEnvironmentsProvider } from '../src/python';
import { activateToolExtension, ToolExtensionRuntime, ToolLifecycleHooks } from '../src';
import { IServerInfo, ToolConfig } from '../src/types';
import * as vscodeapi from '../src/vscodeapi';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function nextImmediate(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

const serverInfo: IServerInfo = { name: 'Example', module: 'example' };
const toolConfig: ToolConfig = {
    toolId: 'example',
    toolDisplayName: 'Example',
    toolModule: 'example',
    minimumPythonVersion: { major: 3, minor: 10 },
    configFiles: ['tool.toml', 'setup.cfg'],
    settingsDefaults: { enabled: false, ignorePatterns: [] },
    trackedSettings: ['args', 'path', 'enabled', 'envFile'],
    serverScript: path.join(process.cwd(), 'bundled', 'tool', 'lsp_server.py'),
};

suite('activateToolExtension', () => {
    let sandbox: sinon.SinonSandbox;
    let runtimes: ToolExtensionRuntime[];
    let resources: Array<{ name: string; dispose: sinon.SinonStub }>;
    let commands: Map<string, () => Promise<void>>;
    let channels: vscode.LogOutputChannel[];
    let configuredInterpreter: string[] | undefined;
    let api: {
        getEnvironment: sinon.SinonStub;
        onDidChangeEnvironment: sinon.SinonStub;
        onDidChangePythonProjects: sinon.SinonStub;
        onDidChangePackages: sinon.SinonStub;
    };
    let start: sinon.SinonSpy;
    let stop: sinon.SinonSpy;
    let initializePython: sinon.SinonSpy;
    let providerDispose: sinon.SinonSpy;

    function resource(name: string, onDispose?: () => void) {
        const disposable = {
            name,
            dispose: sandbox.stub().callsFake(onDispose ?? (() => undefined)),
        };
        resources.push(disposable);
        return disposable;
    }

    function makeContext() {
        const unrelated = resource('unrelated');
        const subscriptions: vscode.Disposable[] = [unrelated];
        return { context: { subscriptions } as vscode.ExtensionContext, unrelated };
    }

    function activate(context: vscode.ExtensionContext, overrides?: Partial<ToolConfig>, hooks?: ToolLifecycleHooks) {
        const runtime = activateToolExtension(context, {
            serverInfo,
            toolConfig: { ...toolConfig, ...overrides },
            hooks,
        });
        runtimes.push(runtime);
        return runtime;
    }

    function makeWatcher() {
        return {
            ...resource('watcher'),
            ignoreCreateEvents: false,
            ignoreChangeEvents: false,
            ignoreDeleteEvents: false,
            onDidChange: sandbox.stub().callsFake(() => resource('watcher.change')),
            onDidCreate: sandbox.stub().callsFake(() => resource('watcher.create')),
            onDidDelete: sandbox.stub().callsFake(() => resource('watcher.delete')),
        };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        runtimes = [];
        resources = [];
        channels = [];
        commands = new Map();
        configuredInterpreter = [path.join(process.cwd(), 'configured-python')];
        sandbox
            .stub(vscode.workspace, 'workspaceFolders')
            .value([{ uri: vscode.Uri.file(process.cwd()), name: 'workspace', index: 0 }]);
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(
            () =>
                ({
                    get: (key: string, fallback?: unknown) =>
                        key === 'interpreter' ? configuredInterpreter : fallback,
                    inspect: (key: string) => ({
                        globalValue: key === 'interpreter' ? configuredInterpreter : undefined,
                    }),
                }) as vscode.WorkspaceConfiguration,
        );
        sandbox.stub(vscode.window, 'createOutputChannel').callsFake((name) => {
            const channel = {
                ...resource('output'),
                name,
                logLevel: vscode.LogLevel.Info,
                appendLine: sandbox.stub(),
                error: sandbox.stub(),
                warn: sandbox.stub(),
                info: sandbox.stub(),
                debug: sandbox.stub(),
                show: sandbox.stub(),
                onDidChangeLogLevel: sandbox.stub().callsFake(() => resource('channel.logLevel')),
            } as unknown as vscode.LogOutputChannel;
            channels.push(channel);
            return channel;
        });
        sandbox.stub(vscode.env, 'onDidChangeLogLevel').callsFake(() => resource('global.logLevel'));
        sandbox.stub(vscodeapi, 'onDidChangeConfiguration').callsFake(() => resource('configuration'));
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((name, callback) => {
            commands.set(name, callback);
            return resource(name, () => commands.delete(name));
        });
        sandbox
            .stub(vscode.languages, 'createLanguageStatusItem')
            .callsFake(() => resource('status') as unknown as vscode.LanguageStatusItem);
        sandbox.stub(vscode.languages, 'registerDocumentFormattingEditProvider').callsFake(() => resource('formatter'));
        sandbox.stub(vscode.workspace, 'createFileSystemWatcher').callsFake(makeWatcher);
        api = {
            getEnvironment: sandbox.stub().resolves({
                version: '3.12.0',
                execInfo: {
                    run: { executable: path.join(process.cwd(), 'managed-python') },
                },
            }),
            onDidChangeEnvironment: sandbox.stub().callsFake(() => resource('python.environment')),
            onDidChangePythonProjects: sandbox.stub().callsFake(() => resource('python.projects')),
            onDidChangePackages: sandbox.stub().callsFake(() => resource('python.packages')),
        };
        sandbox.stub(PythonEnvironments, 'api').resolves(api as unknown as PythonEnvironmentApi);
        start = sandbox.spy(LanguageClient.prototype, 'start');
        stop = sandbox.spy(LanguageClient.prototype, 'stop');
        initializePython = sandbox.spy(PythonEnvironmentsProvider.prototype, 'initializePython');
        providerDispose = sandbox.spy(PythonEnvironmentsProvider.prototype, 'dispose');
    });

    teardown(async () => {
        await Promise.all(runtimes.map((runtime) => runtime.deactivate()));
        sandbox.restore();
    });

    for (const interpreter of ['configured', 'Python-managed']) {
        test(`matches manual composition for ${interpreter} startup and restart`, async () => {
            if (interpreter === 'Python-managed') {
                configuredInterpreter = undefined;
            }

            function snapshot() {
                const client = start.lastCall.thisValue as LanguageClient;
                return {
                    initializationOptions: client.clientOptions.initializationOptions,
                    commands: Array.from(commands.keys()),
                    registrations: resources.map((item) => item.name),
                };
            }

            // Real shared helpers, settings resolution and server composition;
            // only VS Code, Python extension and LanguageClient APIs are mocked.
            const subscriptions: vscode.Disposable[] = [];
            const outputChannel = vscodeapi.createOutputChannel(serverInfo.name);
            const logger = registerLogger(outputChannel);
            const pythonProvider = new PythonEnvironmentsProvider(toolConfig);
            const ctx = activation.createToolContext({
                serverInfo,
                outputChannel,
                toolConfig,
                pythonProvider,
            });
            activation.registerCommonSubscriptions(
                { subscriptions },
                {
                    serverInfo,
                    outputChannel,
                    toolConfig,
                    pythonProvider,
                    toolContext: ctx,
                },
            );
            const scheduled = setImmediate(() => void ctx.initialize(subscriptions));
            const manual = {
                deactivate: async () => {
                    clearImmediate(scheduled);
                    await activation.deactivateServer(ctx);
                    subscriptions
                        .splice(0)
                        .reverse()
                        .forEach((item) => item.dispose());
                    pythonProvider.dispose();
                    logger.dispose();
                    outputChannel.dispose();
                },
            };
            runtimes.push(manual);
            await nextImmediate();
            assert.equal(start.callCount, 1);
            const expectedStartup = snapshot();
            await commands.get('example.restart')!();
            assert.equal(start.callCount, 2);
            const expectedRestart = snapshot();
            await manual.deactivate();
            runtimes.pop();

            resources = [];
            const { context, unrelated } = makeContext();
            // The unrelated caller resource is not part of the manual inventory.
            resources = [];
            const runtime = activate(context);
            assert.equal(start.callCount, 2, 'startup stays deferred');
            assert.lengthOf(context.subscriptions, 2, 'only a lifetime handle belongs to the caller');
            await nextImmediate();

            assert.equal(start.callCount, 3, 'the initial interpreter event starts exactly one client');
            assert.equal(initializePython.callCount, interpreter === 'configured' ? 0 : 2);
            assert.deepEqual(snapshot(), expectedStartup);
            const restartCommand = commands.get('example.restart')!;
            await restartCommand();
            assert.equal(start.callCount, 4, 'one command triggers one restart');
            assert.deepEqual(snapshot(), expectedRestart);
            await runtime.deactivate();
            assert.equal(commands.size, 0);
            assert.isTrue(unrelated.dispose.notCalled);
            await restartCommand();
            assert.equal(start.callCount, 4, 'shutdown prevents a stale callback from restarting the client');
        });
    }

    test('cancels deferred startup and the formatter placeholder with idempotent shutdown', async () => {
        const { context, unrelated } = makeContext();
        const runtime = activate(context, { isFormatter: true });
        const formatter = resources.find((item) => item.name === 'formatter')!;
        assert.isDefined(formatter, 'formatter is available synchronously before startup');
        const lifetime = context.subscriptions[1];
        const shutdown = runtime.deactivate();
        assert.isTrue(formatter.dispose.calledOnce);
        lifetime.dispose();
        lifetime.dispose();
        assert.strictEqual(runtime.deactivate(), shutdown);
        await shutdown;
        await nextImmediate();
        assert.isTrue(start.notCalled);
        assert.isTrue(initializePython.notCalled);
        assert.isTrue(providerDispose.calledOnce);
        assert.isTrue(unrelated.dispose.notCalled);
        assert.lengthOf(context.subscriptions, 2);
        assert.lengthOf(
            resources.filter((item) => item.name === 'formatter'),
            1,
        );
        for (const item of resources.filter((item) => item !== unrelated)) {
            assert.isTrue(item.dispose.calledOnce, item.name);
        }
    });

    test('context disposal initiates the same awaitable shutdown', async () => {
        const { context } = makeContext();
        const runtime = activate(context);
        await nextImmediate();
        const stopping = deferred<void>();
        stop.restore();
        const stopStub = sandbox.stub(LanguageClient.prototype, 'stop').returns(stopping.promise);
        context.subscriptions[1].dispose();
        assert.isTrue(stopStub.calledOnce);
        assert.isTrue((channels[0].dispose as sinon.SinonStub).notCalled);
        const shutdown = runtime.deactivate();
        context.subscriptions[1].dispose();
        stopping.resolve();
        await shutdown;
        assert.isTrue(stopStub.calledOnce);
        assert.isTrue((channels[0].dispose as sinon.SinonStub).calledOnce);
    });

    test('rolls back partial activation without touching caller resources', async () => {
        const { context, unrelated } = makeContext();
        const partial = makeWatcher();
        partial.onDidCreate.throws(new Error('watcher setup failed'));
        (vscode.workspace.createFileSystemWatcher as sinon.SinonStub).onSecondCall().returns(partial);
        assert.throws(() => activate(context, { isFormatter: true }), 'watcher setup failed');
        await nextImmediate();
        assert.lengthOf(context.subscriptions, 1);
        assert.isTrue(unrelated.dispose.notCalled);
        for (const item of resources.filter((item) => item !== unrelated)) {
            assert.isTrue(item.dispose.calledOnce, item.name);
        }
        assert.isTrue(providerDispose.calledOnce);
        assert.isTrue(start.notCalled);
        assert.equal(commands.size, 0);
        assert.isTrue((channels[0].error as sinon.SinonStub).calledWithMatch('watcher setup failed'));
    });

    test('awaits late initialization subscriptions and contains cleanup failures', async () => {
        const late = resource('python.environment');
        const disposing = deferred<void>();
        late.dispose.callsFake(async () => {
            await disposing.promise;
            throw new Error('late disposal rejected');
        });
        api.onDidChangeEnvironment.returns(late);
        const acquisition = deferred<typeof api>();
        (PythonEnvironments.api as sinon.SinonStub).returns(acquisition.promise);
        configuredInterpreter = undefined;
        const { context, unrelated } = makeContext();
        const runtime = activate(context, {
            isFormatter: true,
            refreshExtensionOnPackagesChange: true,
        });
        await nextImmediate();
        assert.isTrue(initializePython.calledOnce);
        resources.find((item) => item.name === 'global.logLevel')!.dispose.throws(new Error('disposal threw'));

        const shutdown = runtime.deactivate();
        let settled = false;
        void shutdown.then(() => {
            settled = true;
        });
        await nextImmediate();
        assert.isFalse(settled);
        assert.isTrue((channels[0].dispose as sinon.SinonStub).notCalled);
        acquisition.resolve(api);
        await nextImmediate();
        assert.isTrue(late.dispose.calledOnce);
        assert.isFalse(settled);
        assert.isTrue((channels[0].dispose as sinon.SinonStub).notCalled);
        disposing.resolve();
        await shutdown;

        for (const name of ['python.environment', 'python.projects', 'python.packages']) {
            const items = resources.filter((item) => item.name === name);
            assert.lengthOf(items, 1, name);
            assert.isTrue(items[0].dispose.calledOnce, name);
        }
        assert.isTrue(start.notCalled, 'the late initial event cannot start a server');
        assert.lengthOf(
            resources.filter((item) => item.name === 'formatter'),
            1,
        );
        assert.isTrue(resources.find((item) => item.name === 'formatter')!.dispose.calledOnce);
        const error = channels[0].error as sinon.SinonStub;
        assert.isTrue(error.calledWithMatch('late disposal rejected'));
        assert.isTrue(error.calledWithMatch('disposal threw'));
        assert.isTrue((channels[0].dispose as sinon.SinonStub).calledOnce);
        assert.isTrue(unrelated.dispose.notCalled);
    });

    test('cleans up an in-flight configured startup without restoring a disposed formatter', async () => {
        const starting = deferred<void>();
        start.restore();
        const startStub = sandbox.stub(LanguageClient.prototype, 'start').returns(starting.promise);
        const clientDispose = sandbox.spy(LanguageClient.prototype, 'dispose');
        const { context } = makeContext();
        const runtime = activate(context, { isFormatter: true });
        await nextImmediate();
        assert.isTrue(startStub.calledOnce);
        const shutdown = runtime.deactivate();
        const formatter = resources.find((item) => item.name === 'formatter')!;
        assert.isTrue(formatter.dispose.calledOnce);
        starting.resolve();
        await shutdown;
        assert.isTrue(stop.calledOnce);
        assert.isTrue(clientDispose.calledOnce);
        assert.lengthOf(
            resources.filter((item) => item.name === 'formatter'),
            1,
        );
    });

    test('keeps old handlers through stop and retires them before replacement setup', async () => {
        const clients: import('./_languageclient_mock').LanguageClient[] = [];
        const handlers: ReturnType<typeof resource>[] = [];
        const received = sandbox.spy();
        const environment = sandbox.spy(() => ({ toolFlag: 'enabled' }));
        start.restore();
        const originalStart = LanguageClient.prototype.start;
        sandbox.stub(LanguageClient.prototype, 'start').callsFake(async function (this: LanguageClient) {
            (this as unknown as import('./_languageclient_mock').LanguageClient)
                .simulateNotification('example/score', 'during-start');
            await originalStart.call(this);
        });
        const { context } = makeContext();
        const runtime = activate(context, undefined, {
            getLaunchEnvironment: environment,
            configureClient: ({ client, registerDisposable }) => {
                clients.push(client as unknown as import('./_languageclient_mock').LanguageClient);
                const owned = resource('client.handlers');
                handlers.push(owned);
                registerDisposable(owned);
                registerDisposable(client.onNotification('example/score', received));
            },
        });
        await nextImmediate();
        assert.lengthOf(clients, 1);
        sinon.assert.calledOnceWithExactly(received, 'during-start');

        stop.restore();
        const originalStop = LanguageClient.prototype.stop;
        const stopping = deferred<void>();
        const stopped = deferred<void>();
        sandbox.stub(LanguageClient.prototype, 'stop').callsFake(async function (this: LanguageClient) {
            stopping.resolve();
            await stopped.promise;
            await originalStop.call(this);
        });
        const restarting = commands.get('example.restart')!();
        await stopping.promise;
        sinon.assert.notCalled(handlers[0].dispose);
        clients[0].simulateNotification('example/score', 'before-stop');
        sinon.assert.calledWithExactly(received, 'before-stop');
        stopped.resolve();
        await restarting;
        assert.lengthOf(clients, 2);
        sinon.assert.calledOnce(handlers[0].dispose);
        sinon.assert.notCalled(handlers[1].dispose);
        sinon.assert.calledTwice(environment);
        const count = received.callCount;
        clients[0].simulateNotification('example/score', 'stale');
        assert.strictEqual(received.callCount, count);
        clients[1].simulateNotification('example/score', 'current');
        assert.strictEqual(received.callCount, count + 1);
        await runtime.deactivate();
        sinon.assert.calledOnce(handlers[1].dispose);
        clients[1].simulateNotification('example/score', 'after-shutdown');
        assert.strictEqual(received.callCount, count + 1);
    });

    test('does not run hooks for coalesced requests and cleans each actual generation once', async () => {
        const { context } = makeContext();
        const hooks = {
            getLaunchEnvironment: sandbox.spy(() => ({})),
            configureClient: sandbox.spy(({ registerDisposable }: Parameters<
                NonNullable<ToolLifecycleHooks['configureClient']>
            >[0]): undefined => {
                registerDisposable(resource('client.handlers'));
            }),
        };
        const runtime = activate(context, { restartDelay: 50 }, hooks);
        await nextImmediate();
        const clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        start.restore();
        const originalStart = LanguageClient.prototype.start;
        const entered = deferred<void>();
        const started = deferred<void>();
        sandbox.stub(LanguageClient.prototype, 'start').callsFake(async function (this: LanguageClient) {
            entered.resolve();
            await started.promise;
            await originalStart.call(this);
        });
        const restart = commands.get('example.restart')!;
        const restarting = restart();
        await entered.promise;
        await restart();
        await restart();
        sinon.assert.calledTwice(hooks.getLaunchEnvironment);
        sinon.assert.calledTwice(hooks.configureClient);
        await clock.tickAsync(50);
        sinon.assert.calledTwice(hooks.configureClient);
        started.resolve();
        await restarting;
        await clock.tickAsync(50);
        sinon.assert.calledThrice(hooks.configureClient);
        sinon.assert.calledThrice(hooks.getLaunchEnvironment);
        await runtime.deactivate();
        const owned = resources.filter((item) => item.name === 'client.handlers');
        assert.lengthOf(owned, 3);
        owned.forEach((item) => sinon.assert.calledOnce(item.dispose));
    });

    for (const stopped of [false, true]) {
        test(`retires old setup after a failed stop leaving the client ${stopped ? 'Stopped' : 'Running'}`, async () => {
            const owned: ReturnType<typeof resource>[] = [];
            const { context } = makeContext();
            const runtime = activate(context, undefined, {
                configureClient: ({ registerDisposable }) => {
                    const handlers = resource('client.handlers');
                    owned.push(handlers);
                    registerDisposable(handlers);
                },
            });
            await nextImmediate();
            const oldClient = start.firstCall.thisValue as LanguageClient;
            stop.restore();
            const originalStop = LanguageClient.prototype.stop;
            sandbox.stub(LanguageClient.prototype, 'stop').callsFake(async function (this: LanguageClient) {
                if (this === oldClient) {
                    if (stopped) {
                        await originalStop.call(this);
                    }
                    throw new Error('stop failed');
                }
                await originalStop.call(this);
            });
            await commands.get('example.restart')!();
            assert.lengthOf(owned, 2);
            sinon.assert.calledOnce(owned[0].dispose);
            sinon.assert.notCalled(owned[1].dispose);
            await runtime.deactivate();
            owned.forEach((item) => sinon.assert.calledOnce(item.dispose));
        });
    }

    test('shutdown closes hook resources before an in-flight start settles', async () => {
        const { context } = makeContext();
        const entered = deferred<void>();
        const started = deferred<void>();
        start.restore();
        sandbox.stub(LanguageClient.prototype, 'start').callsFake(async () => {
            entered.resolve();
            await started.promise;
        });
        const owned = resource('client.handlers');
        const runtime = activate(context, undefined, {
            configureClient: ({ registerDisposable }) => {
                registerDisposable(owned);
            },
        });
        await entered.promise;
        const shutdown = runtime.deactivate();
        sinon.assert.calledOnce(owned.dispose);
        started.resolve();
        await shutdown;
        sinon.assert.calledOnce(stop);
        sinon.assert.calledOnce(owned.dispose);
    });

    test('contains unexpected initializer rejections and still cleans up', async () => {
        const toolContext = {
            lsClient: undefined,
            initialize: sandbox.stub().rejects(new Error('unexpected initializer rejection')),
            runServer: sandbox.stub().resolves(),
            dispose: sandbox.stub(),
        };
        sandbox.stub(activation, 'createToolContext').returns(toolContext);
        const { context } = makeContext();
        const runtime = activate(context);
        await nextImmediate();
        assert.isTrue((channels[0].error as sinon.SinonStub).calledWithMatch('unexpected initializer rejection'));
        await runtime.deactivate();
        assert.isTrue(toolContext.dispose.calledOnce);
        assert.isTrue((channels[0].dispose as sinon.SinonStub).calledOnce);
    });
});
