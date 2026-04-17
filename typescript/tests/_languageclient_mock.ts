// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Minimal mock of vscode-languageclient for unit testing.
 */

export enum State {
    Stopped = 1,
    Starting = 3,
    Running = 2,
}

export enum RevealOutputChannelOn {
    Info = 1,
    Warn = 2,
    Error = 3,
    Never = 4,
}

export class LanguageClient {
    private _id: string;
    private _name: string;
    private _serverOptions: unknown;
    private _clientOptions: unknown;
    private _stateListeners: Array<(e: { oldState: State; newState: State }) => void> = [];
    private _state: State = State.Stopped;

    constructor(id: string, name: string, serverOptions: unknown, clientOptions: unknown) {
        this._id = id;
        this._name = name;
        this._serverOptions = serverOptions;
        this._clientOptions = clientOptions;
    }

    onDidChangeState(listener: (e: { oldState: State; newState: State }) => void) {
        this._stateListeners.push(listener);
        return {
            dispose: () => {
                const idx = this._stateListeners.indexOf(listener);
                if (idx >= 0) this._stateListeners.splice(idx, 1);
            },
        };
    }

    async start(): Promise<void> {
        this._state = State.Running;
    }

    async stop(): Promise<void> {
        this._state = State.Stopped;
    }

    async setTrace(_level: unknown): Promise<void> {
        // no-op
    }
}

export type LanguageClientOptions = Record<string, unknown>;
export type ServerOptions = Record<string, unknown>;
