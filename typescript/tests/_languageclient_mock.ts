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
    private _stateListeners: Array<(e: { oldState: State; newState: State }) => void> = [];
    private _state: State = State.Stopped;
    private _notificationHandlers = new Map<string, Set<(params: unknown) => void>>();

    /** Exposed for test assertions on the constructed server options. */
    public readonly serverOptions: unknown;
    /** Exposed for test assertions on the constructed client options. */
    public readonly clientOptions: unknown;

    constructor(id: string, name: string, serverOptions: unknown, clientOptions: unknown) {
        this._id = id;
        this._name = name;
        this.serverOptions = serverOptions;
        this.clientOptions = clientOptions;
    }

    get state(): State {
        return this._state;
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

    simulateStateChange(newState: State): void {
        const oldState = this._state;
        this._state = newState;
        this._stateListeners.forEach((l) => l({ oldState, newState }));
    }

    onNotification(method: string, handler: (params: unknown) => void) {
        let handlers = this._notificationHandlers.get(method);
        if (!handlers) {
            handlers = new Set();
            this._notificationHandlers.set(method, handlers);
        }
        handlers.add(handler);
        return { dispose: () => handlers.delete(handler) };
    }

    simulateNotification(method: string, params: unknown): void {
        this._notificationHandlers.get(method)?.forEach((handler) => handler(params));
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

    dispose(): void {
        this._state = State.Stopped;
    }
}

export type LanguageClientOptions = Record<string, unknown>;
export type ServerOptions = Record<string, unknown>;

export class Command {
    static create(title: string, command: string, ...args: unknown[]) {
        return { title, command, arguments: args };
    }
}
