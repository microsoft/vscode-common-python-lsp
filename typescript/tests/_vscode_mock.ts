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

    static parse(value: string): Uri {
        // Match URI schemes per RFC 3986: letter followed by letters/digits/+/-.
        const absoluteUriMatch = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/);
        if (absoluteUriMatch) {
            return new Uri(absoluteUriMatch[1], absoluteUriMatch[2]);
        }
        const schemeMatch = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/);
        if (schemeMatch) {
            return new Uri(schemeMatch[1], schemeMatch[2]);
        }
        return new Uri('file', value);
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
export type ConfigurationChangeEvent = any;
export type DocumentSelector = any;

export enum LanguageStatusSeverity {
    Information = 0,
    Warning = 1,
    Error = 2,
}

export enum LogLevel {
    Off = 0,
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warning = 4,
    Error = 5,
}

export class CompletionItem {
    label: string;
    constructor(label: string) {
        this.label = label;
    }
}

export class CompletionList {
    items: CompletionItem[] = [];
}

export class CodeAction {
    title: string;
    constructor(title: string) {
        this.title = title;
    }
}

export class CodeLens {
    range: any;
}

export class DocumentLink {
    range: any;
}

export class SymbolInformation {
    name: string = '';
}

export class InlayHint {
    label: string = '';
}

export class Diagnostic {
    message: string = '';
}

export class DocumentSymbol {
    name: string = '';
}

export const l10n = {
    t: (s: string) => s,
};

export const env = {
    logLevel: LogLevel.Info,
    onDidChangeLogLevel: () => ({ dispose: () => {} }),
};

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
