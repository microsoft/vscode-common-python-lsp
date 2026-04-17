// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as sinon from 'sinon';
import { workspace } from 'vscode';
import { createConfigFileWatchers } from '../src/configWatcher';

suite('configWatcher', () => {
    let createFileSystemWatcherStub: sinon.SinonStub;

    setup(() => {
        createFileSystemWatcherStub = sinon.stub(workspace, 'createFileSystemWatcher');
    });

    teardown(() => {
        sinon.restore();
    });

    function makeMockWatcher() {
        const handlers: Record<string, (() => void)[]> = {
            change: [],
            create: [],
            delete: [],
        };
        return {
            onDidChange: (fn: () => void) => {
                handlers.change.push(fn);
                return { dispose: sinon.stub() };
            },
            onDidCreate: (fn: () => void) => {
                handlers.create.push(fn);
                return { dispose: sinon.stub() };
            },
            onDidDelete: (fn: () => void) => {
                handlers.delete.push(fn);
                return { dispose: sinon.stub() };
            },
            dispose: sinon.stub(),
            _handlers: handlers,
        };
    }

    test('creates one watcher per config file pattern', () => {
        const watcher1 = makeMockWatcher();
        const watcher2 = makeMockWatcher();
        createFileSystemWatcherStub.onFirstCall().returns(watcher1);
        createFileSystemWatcherStub.onSecondCall().returns(watcher2);

        const disposables = createConfigFileWatchers(['.flake8', 'setup.cfg'], 'Flake8', async () => {});

        assert.equal(disposables.length, 2);
        assert.isTrue(createFileSystemWatcherStub.calledTwice);
        assert.equal(createFileSystemWatcherStub.firstCall.args[0], '**/.flake8');
        assert.equal(createFileSystemWatcherStub.secondCall.args[0], '**/setup.cfg');
    });

    test('calls onConfigChanged when file changes', async () => {
        const watcher = makeMockWatcher();
        createFileSystemWatcherStub.returns(watcher);

        const onChanged = sinon.stub().resolves();
        createConfigFileWatchers(['.flake8'], 'Flake8', onChanged);

        // Trigger the change handler
        watcher._handlers.change[0]();

        // Wait for async handler
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.isTrue(onChanged.calledOnce);
    });

    test('calls onConfigChanged when file is created', async () => {
        const watcher = makeMockWatcher();
        createFileSystemWatcherStub.returns(watcher);

        const onChanged = sinon.stub().resolves();
        createConfigFileWatchers(['.flake8'], 'Flake8', onChanged);

        watcher._handlers.create[0]();
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.isTrue(onChanged.calledOnce);
    });

    test('calls onConfigChanged when file is deleted', async () => {
        const watcher = makeMockWatcher();
        createFileSystemWatcherStub.returns(watcher);

        const onChanged = sinon.stub().resolves();
        createConfigFileWatchers(['.flake8'], 'Flake8', onChanged);

        watcher._handlers.delete[0]();
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.isTrue(onChanged.calledOnce);
    });

    test('dispose cleans up all listeners', () => {
        const watcher = makeMockWatcher();
        createFileSystemWatcherStub.returns(watcher);

        const disposables = createConfigFileWatchers(['.flake8'], 'Flake8', async () => {});

        disposables[0].dispose();
        assert.isTrue(watcher.dispose.calledOnce);
    });

    test('does not call handler after dispose', async () => {
        const watcher = makeMockWatcher();
        createFileSystemWatcherStub.returns(watcher);

        const onChanged = sinon.stub().resolves();
        const disposables = createConfigFileWatchers(['.flake8'], 'Flake8', onChanged);

        disposables[0].dispose();

        // Try to fire after dispose
        watcher._handlers.change[0]();
        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.isFalse(onChanged.called);
    });

    test('returns empty array for empty config files', () => {
        const disposables = createConfigFileWatchers([], 'Flake8', async () => {});
        assert.deepEqual(disposables, []);
        assert.isFalse(createFileSystemWatcherStub.called);
    });
});
