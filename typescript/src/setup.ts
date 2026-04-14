// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as path from 'path';
import * as fs from 'fs-extra';
import { IServerInfo } from './types';

export function loadServerDefaults(extensionRootDir: string): IServerInfo {
    const packageJson = path.join(extensionRootDir, 'package.json');
    const content = fs.readFileSync(packageJson).toString();
    const config = JSON.parse(content);
    return config.serverInfo as IServerInfo;
}
