// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as path from 'path';
import { resolveExtensionRoot } from '../src/setup';

suite('Setup utilities', () => {
    suite('resolveExtensionRoot', () => {
        test('navigates 2 levels up when dirname is "common" (dev layout)', () => {
            // Simulates: <root>/src/common/constants.ts → __dirname = <root>/src/common → root = <root>
            const root = path.join('users', 'dev', 'ext');
            const dirname = path.join(root, 'src', 'common');
            const result = resolveExtensionRoot(dirname);
            assert.strictEqual(result, root);
        });

        test('navigates 1 level up for non-"common" dirname (production layout)', () => {
            // Simulates: <root>/dist/extension.js → __dirname = <root>/dist → root = <root>
            const root = path.join('users', 'dev', 'ext');
            const dirname = path.join(root, 'dist');
            const result = resolveExtensionRoot(dirname);
            assert.strictEqual(result, root);
        });

        test('handles absolute paths correctly', () => {
            const root = path.resolve(path.sep, 'project', 'ext');
            const dirname = path.join(root, 'src', 'common');
            const result = resolveExtensionRoot(dirname);
            assert.strictEqual(result, root);
        });
    });
});
