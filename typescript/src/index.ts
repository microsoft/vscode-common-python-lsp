// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Shared TypeScript utilities for VS Code Python tool extensions.
 *
 * @packageDocumentation
 */

// Types
export { IBaseSettings, IInitOptions, IResolvedPythonEnvironment, IServerInfo, ToolConfig } from './types';

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
export { ExtensionPaths, loadServerDefaults, resolveExtensionPaths, resolveExtensionRoot } from './setup';

// Status
export { registerLanguageStatusItem, updateStatus } from './status';

// Env file
export { getEnvFileVars } from './envFile';

// Settings & variable substitution
export {
    checkIfConfigurationChanged,
    expandTilde,
    getExtensionSettings,
    getExtraPaths,
    getGlobalSettings,
    getWorkspaceSettings,
    logLegacySettings,
    resolvePathSetting,
    resolveVariables,
} from './settings';

// Python interpreter resolution
export { IInterpreterDetails, IPythonApi, PythonEnvironmentsProvider } from './python';

// Config file watching
export { createConfigFileWatchers } from './configWatcher';

// Server lifecycle
export {
    createServer,
    CreateServerOptions,
    getServerCwd,
    restartServer,
    RestartServerOptions,
    RestartServerResult,
} from './server';

// Activation / deactivation
export {
    createToolContext,
    CreateToolContextOptions,
    deactivateServer,
    registerCommonSubscriptions,
    RegisterSubscriptionsOptions,
    ToolExtensionContext,
} from './activation';
