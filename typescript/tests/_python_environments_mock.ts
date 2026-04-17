// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Mock for `@vscode/python-environments` module.
 * Both `PythonEnvironments.api()` and any types are stubbed.
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

export const PythonEnvironments = {
    api: async (): Promise<any> => {
        throw new Error('Python environments extension not available in tests');
    },
};
