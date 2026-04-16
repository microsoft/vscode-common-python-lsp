// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as fs from 'fs-extra';
import { IServerInfo } from './types';

export function loadServerDefaults(extensionRootDir: string): IServerInfo {
    const packageJson = path.join(extensionRootDir, 'package.json');

    let content: string;
    try {
        content = fs.readFileSync(packageJson).toString();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read "${packageJson}": ${message}`);
    }

    let config: Record<string, unknown>;
    try {
        config = JSON.parse(content);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in "${packageJson}": ${message}`);
    }

    const serverInfo = config.serverInfo;
    if (!serverInfo || typeof serverInfo !== 'object') {
        throw new Error(`Missing or invalid "serverInfo" in "${packageJson}".`);
    }

    return serverInfo as IServerInfo;
}
