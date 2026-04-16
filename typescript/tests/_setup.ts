// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Mocha setup: intercept `require('vscode')` and redirect to our mock.
 * Loaded via mocha --require before any test files.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const Module = require('module');
const path = require('path');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
    if (request === 'vscode') {
        return path.resolve(__dirname, '_vscode_mock.js');
    }
    return originalResolveFilename.call(this, request, ...args);
};
