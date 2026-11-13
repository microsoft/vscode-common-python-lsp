// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { WorkspaceFolder } from 'vscode';
import {
    createToolContext,
    CreateToolContextOptions,
    getExtensionSettings,
    getGlobalSettings,
    getWorkspaceSettings,
    IBaseSettings,
    IInitOptions,
    ToolConfig,
    ToolDefinition,
    ToolSettings,
} from '../src';

declare function expectType<T>(value: T): void;

interface LintSettings {
    ignorePatterns: string[];
    severity: Record<string, string>;
    enabled: boolean;
    optionalLabel?: string;
}

// Compiled by the existing pretest (tsconfig.test.json), not executed by Mocha.
export async function checkToolDefinitions(
    workspace: WorkspaceFolder,
    contextOptions: Omit<CreateToolContextOptions, 'toolConfig'>,
): Promise<void> {
    const tool: ToolDefinition<LintSettings> = {
        toolId: 'example',
        toolDisplayName: 'Example',
        toolModule: 'example',
        minimumPythonVersion: { major: 3, minor: 10 },
        configFiles: ['tool.toml'],
        serverScript: 'bundled/tool/lsp_server.py',
        settingsDefaults: {
            ignorePatterns: [],
            severity: { error: 'Error' },
            enabled: false,
        },
        trackedSettings: ['args', 'path', 'interpreter', 'ignorePatterns', 'severity', 'envFile'],
    };

    const legacyCompatible: ToolConfig = tool;
    const options: CreateToolContextOptions = { ...contextOptions, toolConfig: tool };
    createToolContext(options).dispose();

    const workspaceSettings = await getWorkspaceSettings('example', workspace, tool, async () => ({ path: [] }));
    const globalSettings = await getGlobalSettings('example', tool, async () => ({ path: [] }));
    const extensionSettings = await getExtensionSettings('example', tool, undefined, [workspace]);

    expectType<ToolSettings<LintSettings>>(workspaceSettings);
    expectType<LintSettings>(workspaceSettings);
    expectType<LintSettings>(globalSettings);
    expectType<LintSettings>(extensionSettings[0]);
    expectType<string[]>(workspaceSettings.ignorePatterns);
    expectType<boolean>(globalSettings.enabled);
    expectType<Record<string, string>>(extensionSettings[0].severity);
    expectType<string | undefined>(workspaceSettings.optionalLabel);
    expectType<string | undefined>(globalSettings.optionalLabel);
    expectType<string | undefined>(extensionSettings[0].optionalLabel);
    expectType<IInitOptions>({ settings: extensionSettings, globalSettings });
    expectType<string[]>(workspaceSettings.args);
    expectType<string>(globalSettings.importStrategy);
    expectType<string[] | undefined>(extensionSettings[0].extraPaths);

    // @ts-expect-error Workspace custom fields must not fall back to unknown or any.
    expectType<number>(workspaceSettings.ignorePatterns);
    // @ts-expect-error Global custom fields must not fall back to unknown or any.
    expectType<string>(globalSettings.enabled);
    // @ts-expect-error Multi-root custom fields must not fall back to unknown or any.
    expectType<number>(extensionSettings[0].severity);
    // @ts-expect-error The declared boolean is not narrowed to its false default.
    expectType<false>(workspaceSettings.enabled);
    // @ts-expect-error The declared string array is not narrowed to never[].
    expectType<never[]>(globalSettings.ignorePatterns);
    // @ts-expect-error A custom field without a required default may be absent.
    expectType<string>(workspaceSettings.optionalLabel);
    // @ts-expect-error Global settings do not materialize omitted optional fields.
    expectType<string>(globalSettings.optionalLabel);
    // @ts-expect-error Multi-root settings do not materialize omitted optional fields.
    expectType<string>(extensionSettings[0].optionalLabel);
    // @ts-expect-error Common fields retain their existing types.
    expectType<number>(workspaceSettings.args);

    expectType<unknown>(workspaceSettings.futureOption);
    // @ts-expect-error Future wire fields require narrowing, not implicit any.
    expectType<string>(workspaceSettings.futureOption);
    // @ts-expect-error Global future fields also remain unknown.
    expectType<string>(globalSettings.futureOption);
    // @ts-expect-error Multi-root future fields also remain unknown.
    expectType<string>(extensionSettings[0].futureOption);
    if (typeof workspaceSettings.futureOption === 'string') {
        expectType<string>(workspaceSettings.futureOption);
    }

    const invalidValue: ToolDefinition<LintSettings> = {
        ...tool,
        settingsDefaults: {
            ...tool.settingsDefaults,
            // @ts-expect-error A declared boolean default cannot be a string.
            enabled: 'false',
        },
    };
    const invalidKey: ToolDefinition<LintSettings> = {
        ...tool,
        settingsDefaults: {
            ...tool.settingsDefaults,
            // @ts-expect-error Explicitly typed defaults reject undeclared settings.
            misspelled: true,
        },
    };
    const missingDefault: ToolDefinition<LintSettings> = {
        ...tool,
        // @ts-expect-error Required custom results need defaults for every required key.
        settingsDefaults: { enabled: false, ignorePatterns: [] },
    };
    // @ts-expect-error Custom declarations cannot contradict a common field.
    type ConflictingBase = ToolDefinition<{ args: number }>;
    // @ts-expect-error Optional declarations cannot contradict a common field either.
    type ConflictingOptionalBase = ToolDefinition<{ cwd?: number }>;
    expectType<unknown>(invalidValue);
    expectType<unknown>(invalidKey);
    expectType<unknown>(missingDefault);

    const commonDefaults: ToolDefinition<{ cwd: 'fixed'; args: ['--fixed']; extraPaths: string[] }> = {
        ...tool,
        settingsDefaults: { cwd: 'fixed', args: ['--fixed'], extraPaths: [] },
    };
    const commonSettings = await getWorkspaceSettings('example', workspace, commonDefaults);
    expectType<string>(commonSettings.cwd);
    expectType<string[]>(commonSettings.args);
    expectType<string[] | undefined>(commonSettings.extraPaths);
    // @ts-expect-error Common fields must not be narrowed by literal defaults.
    expectType<'fixed'>(commonSettings.cwd);
    // @ts-expect-error Common array fields must not be narrowed to default tuples.
    expectType<['--fixed']>(commonSettings.args);
    // @ts-expect-error Common optional fields retain their existing optionality.
    expectType<string[]>(commonSettings.extraPaths);

    const legacyLinter: ToolConfig = {
        ...legacyCompatible,
        settingsDefaults: { enabled: true, severity: { error: 'Error' }, ignorePatterns: [] },
    };
    const legacyFormatter: ToolConfig = {
        ...legacyCompatible,
        toolId: 'formatter',
        isFormatter: true,
        restartDelay: 250,
        pythonUtf8: true,
        settingsDefaults: { serverArgs: ['--workers', '1'], useDaemon: false },
        trackedSettings: ['args', 'path', 'interpreter', 'serverArgs', 'useDaemon', 'envFile'],
    };
    expectType<CreateToolContextOptions>({ ...contextOptions, toolConfig: legacyFormatter });
    expectType<Promise<IBaseSettings>>(getWorkspaceSettings('example', workspace, legacyLinter));
    expectType<Promise<IBaseSettings>>(getGlobalSettings('formatter', legacyFormatter));
    expectType<Promise<IBaseSettings[]>>(getExtensionSettings('formatter', legacyFormatter));
    const legacySettings = await getWorkspaceSettings('example', workspace, legacyCompatible);
    // @ts-expect-error Unparameterized ToolConfig keeps the legacy unknown-valued surface.
    expectType<boolean>(legacySettings.enabled);

    interface FormatterSettings {
        serverArgs: string[];
        useDaemon: boolean;
    }
    const formatter: ToolDefinition<FormatterSettings> = {
        ...legacyFormatter,
        settingsDefaults: { serverArgs: [], useDaemon: false },
    };
    expectType<FormatterSettings>(await getGlobalSettings('formatter', formatter));
}
