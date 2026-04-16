// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared TypeScript utilities for VS Code Python tool extensions.
 *
 * @packageDocumentation
 */

// Types
export { IBaseSettings, IInitOptions, IServerInfo, ToolConfig } from './types';

// Logging
export { registerLogger, traceError, traceInfo, traceLog, traceVerbose, traceWarn } from './logging';

// VS Code API wrappers
export {
    createLanguageStatusItem,
    createOutputChannel,
    createStatusBarItem,
    getConfiguration,
    getWorkspaceFolder,
    getWorkspaceFolders,
    isVirtualWorkspace,
    onDidChangeActiveTextEditor,
    onDidChangeConfiguration,
    registerCommand,
    registerDocumentFormattingEditProvider,
} from './vscodeapi';

// Utilities
export { getDocumentSelector, getInterpreterFromSetting, getLSClientTraceLevel, getProjectRoot } from './utilities';

// Setup
export { loadServerDefaults } from './setup';

// Status
export { registerLanguageStatusItem, updateStatus } from './status';

// Env file
export { getEnvFileVars } from './envFile';

// Settings & variable substitution
export { expandTilde, resolvePathSetting, resolveVariables } from './settings';
