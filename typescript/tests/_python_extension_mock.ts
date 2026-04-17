// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Mock for `@vscode/python-extension` module.
 * `PythonExtension.api()` is stubbed to reject (no extension in tests).
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export const PythonExtension = {
    api: async (): Promise<any> => {
        throw new Error('Python extension not available in tests');
    },
};

export interface ResolvedEnvironment {
    id: string;
    path: string;
    executable: {
        uri?: { fsPath: string };
        bitness: string;
        sysPrefix: string;
    };
    version?: {
        major: number;
        minor: number;
        micro: number;
        release: { level: string; serial: number };
        sysVersion: string;
    };
    environment: any;
    tools: any[];
}
