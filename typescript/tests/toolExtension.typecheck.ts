// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ExtensionContext } from 'vscode';
import {
    activateToolExtension,
    ActivateToolExtensionOptions,
    IServerInfo,
    ToolConfig,
    ToolDefinition,
    ToolExtensionRuntime,
} from '../src';

// Compile-only adoption checks; no lifecycle/client generics or casts are needed.
export async function checkActivationFacade(
    context: ExtensionContext,
    serverInfo: IServerInfo,
    legacy: ToolConfig,
): Promise<void> {
    const legacyOptions: ActivateToolExtensionOptions = {
        serverInfo,
        toolConfig: legacy,
    };
    const legacyRuntime: ToolExtensionRuntime = activateToolExtension(context, legacyOptions);
    const shutdown: Promise<void> = legacyRuntime.deactivate();
    await shutdown;

    interface Settings {
        enabled: boolean;
        ignorePatterns: string[];
    }
    const definition: ToolDefinition<Settings> = {
        ...legacy,
        settingsDefaults: { enabled: false, ignorePatterns: [] },
    };
    const typedOptions: ActivateToolExtensionOptions = {
        serverInfo,
        toolConfig: definition,
    };
    const runtime: ToolExtensionRuntime = activateToolExtension(context, typedOptions);
    // @ts-expect-error The facade handle does not expose a mutable language client.
    runtime.lsClient = undefined;
    await runtime.deactivate();
}
