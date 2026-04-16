// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as dotenv from 'dotenv';
import * as fsapi from 'fs-extra';
import { WorkspaceFolder } from 'vscode';
import { traceLog, traceWarn } from './logging';
import { resolvePathSetting } from './settings';
import { getConfiguration } from './vscodeapi';

/**
 * Reads the env file configured via `python.envFile` (defaults to `${workspaceFolder}/.env`),
 * parses it using dotenv, and returns the resulting environment variables.
 * Returns an empty record if the file does not exist or cannot be read.
 */
export async function getEnvFileVars(workspace: WorkspaceFolder): Promise<Record<string, string>> {
    const pythonConfig = getConfiguration('python', workspace.uri);
    const rawPath = pythonConfig.get<string>('envFile', '${workspaceFolder}/.env');
    const envFilePath = resolvePathSetting(rawPath, workspace);

    try {
        if (await fsapi.pathExists(envFilePath)) {
            const content = await fsapi.readFile(envFilePath, 'utf-8');
            const environmentVariables = dotenv.parse(content);
            const count = Object.keys(environmentVariables).length;
            if (count > 0) {
                traceLog(`Loaded ${count} environment variable(s) from ${envFilePath}`);
            }
            return environmentVariables;
        }
    } catch (err) {
        traceWarn(`Failed to read env file ${envFilePath}: ${err}`);
    }
    return {};
}
