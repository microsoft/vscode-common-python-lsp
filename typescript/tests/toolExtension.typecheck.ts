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
    ToolLifecycleHooks,
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
        hooks: {
            getLaunchEnvironment: ({ settings, serverId, serverName }) => {
                const interpreter: string[] = settings.interpreter;
                const custom: unknown = settings.enabled;
                return {
                    /* eslint-disable @typescript-eslint/naming-convention -- Environment keys retain their actual spelling. */
                    EXAMPLE_INTERPRETER: interpreter[0],
                    EXAMPLE_ID: serverId,
                    EXAMPLE_NAME: serverName,
                    EXAMPLE_CUSTOM: custom === true ? '1' : undefined,
                    /* eslint-enable @typescript-eslint/naming-convention */
                };
            },
            configureClient: ({ client, registerDisposable, settings }) => {
                const interpreter: string[] = settings.interpreter;
                registerDisposable(client.onNotification('example/score', (_score: number) => {
                    void interpreter;
                }));
            },
        } satisfies ToolLifecycleHooks,
    };
    const runtime: ToolExtensionRuntime = activateToolExtension(context, typedOptions);
    // @ts-expect-error The facade handle does not expose a mutable language client.
    runtime.lsClient = undefined;
    await runtime.deactivate();
}

export const invalidAsyncSetup: ToolLifecycleHooks = {
    // @ts-expect-error Setup is synchronous; client readiness cannot depend on an async callback.
    configureClient: async () => {},
};
