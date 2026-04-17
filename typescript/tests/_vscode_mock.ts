// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Minimal mock of the `vscode` module for unit testing outside the extension host.
 * Only the types and objects used by the shared package are mocked here.
 */

export class Uri {
    readonly scheme: string;
    readonly fsPath: string;

    private constructor(scheme: string, fsPath: string) {
        this.scheme = scheme;
        this.fsPath = fsPath;
    }

    static file(filePath: string): Uri {
        return new Uri('file', filePath);
    }

    toString(): string {
        return `${this.scheme}://${this.fsPath}`;
    }
}

export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Stub event emitters (return a no-op Disposable)
const noopEvent = () => ({ dispose: () => {} });

export const workspace = {
    getConfiguration: () => ({
        get: () => undefined,
    }),
    workspaceFolders: undefined as WorkspaceFolder[] | undefined,
    onDidChangeConfiguration: noopEvent,
    getWorkspaceFolder: () => undefined,
    createFileSystemWatcher: () => ({
        onDidChange: noopEvent,
        onDidCreate: noopEvent,
        onDidDelete: noopEvent,
        dispose: () => {},
    }),
};

export const window = {
    createOutputChannel: () => ({}),
    onDidChangeActiveTextEditor: noopEvent,
    createStatusBarItem: () => ({}),
};

export const commands = {
    registerCommand: () => ({ dispose: () => {} }),
};

export const languages = {
    registerDocumentFormattingEditProvider: () => ({ dispose: () => {} }),
    createLanguageStatusItem: () => ({}),
};

export enum StatusBarAlignment {
    Left = 1,
    Right = 2,
}

export type Disposable = { dispose: () => any };
export type ConfigurationScope = any;
export type WorkspaceConfiguration = any;
export type LogOutputChannel = any;
export type LanguageStatusItem = any;
export type StatusBarItem = any;
export type DocumentFormattingEditProvider = any;

export class EventEmitter<T = void> {
    private handlers: Array<(e: T) => void> = [];

    get event(): (listener: (e: T) => void) => Disposable {
        return (listener: (e: T) => void) => {
            this.handlers.push(listener);
            return {
                dispose: () => {
                    const idx = this.handlers.indexOf(listener);
                    if (idx >= 0) {
                        this.handlers.splice(idx, 1);
                    }
                },
            };
        };
    }

    fire(data: T): void {
        this.handlers.forEach((h) => h(data));
    }

    dispose(): void {
        this.handlers = [];
    }
}
