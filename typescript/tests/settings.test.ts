// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from 'chai';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { Uri, WorkspaceFolder } from 'vscode';
import { resolveVariables, expandTilde, resolvePathSetting } from '../src/settings';
import * as vscodeapi from '../src/vscodeapi';

const home = os.homedir();
const cwd = process.cwd();

function makeWorkspace(name: string, fsPath: string, index: number = 0): WorkspaceFolder {
    return { uri: Uri.file(fsPath), name, index };
}

suite('settings', () => {
    const workspace = makeWorkspace('my-project', '/home/user/projects/my-project');
    let getWorkspaceFoldersStub: sinon.SinonStub;

    setup(() => {
        getWorkspaceFoldersStub = sinon.stub(vscodeapi, 'getWorkspaceFolders');
        getWorkspaceFoldersStub.returns([workspace]);
    });

    teardown(() => {
        sinon.restore();
    });

    // ── resolveVariables ──────────────────────────────────────────────

    suite('resolveVariables', () => {
        suite('single variable substitution', () => {
            const cases: [string, string[], string[]][] = [
                [
                    '${workspaceFolder}',
                    ['${workspaceFolder}/src'],
                    [`${workspace.uri.fsPath}/src`],
                ],
                [
                    '${userHome}',
                    ['${userHome}/.config'],
                    [`${home}/.config`],
                ],
                [
                    '${cwd}',
                    ['${cwd}/output'],
                    [`${cwd}/output`],
                ],
                [
                    '${workspaceFolder:name}',
                    ['${workspaceFolder:my-project}/lib'],
                    [`${workspace.uri.fsPath}/lib`],
                ],
            ];

            cases.forEach(([label, input, expected]) => {
                test(label, () => {
                    assert.deepStrictEqual(resolveVariables(input, workspace), expected);
                });
            });
        });

        test('${env:VAR} resolves environment variables', () => {
            const env = { MY_TOOL_PATH: '/opt/tools/bin' };
            const result = resolveVariables(['${env:MY_TOOL_PATH}/formatter'], workspace, undefined, env);
            assert.deepStrictEqual(result, ['/opt/tools/bin/formatter']);
        });

        test('${env:VAR} skips undefined env values', () => {
            const env = { DEFINED: 'yes', EMPTY: '' };
            const result = resolveVariables(
                ['${env:DEFINED}', '${env:EMPTY}', '${env:MISSING}'],
                workspace,
                undefined,
                env,
            );
            assert.deepStrictEqual(result, ['yes', '${env:EMPTY}', '${env:MISSING}']);
        });

        test('defaults to process.env when env not provided', () => {
            const key = '__VSCODE_COMMON_TEST_VAR__';
            const original = process.env[key];
            try {
                process.env[key] = 'from-process-env';
                const result = resolveVariables([`\${env:${key}}`], workspace);
                assert.deepStrictEqual(result, ['from-process-env']);
            } finally {
                if (original === undefined) {
                    delete process.env[key];
                } else {
                    process.env[key] = original;
                }
            }
        });

        suite('tilde expansion', () => {
            const cases: [string, string[], string[]][] = [
                ['~/ prefix', ['~/bin/tool'], [path.join(home, 'bin/tool')]],
                ['~\\ prefix', ['~\\bin\\tool'], [path.join(home, 'bin\\tool')]],
                ['bare ~', ['~'], [home]],
            ];

            cases.forEach(([label, input, expected]) => {
                test(label, () => {
                    assert.deepStrictEqual(resolveVariables(input, workspace), expected);
                });
            });

            test('does not expand mid-string tilde', () => {
                const result = resolveVariables(['/path/to/~/file'], workspace);
                assert.deepStrictEqual(result, ['/path/to/~/file']);
            });
        });

        suite('${interpreter} splice', () => {
            test('splices interpreter array in place', () => {
                const interpreter = ['/usr/bin/python3', '-u'];
                const result = resolveVariables(
                    ['--flag', '${interpreter}', '--verbose'],
                    workspace,
                    interpreter,
                );
                assert.deepStrictEqual(result, ['--flag', '/usr/bin/python3', '-u', '--verbose']);
            });

            test('splices with variable resolution in interpreter segments', () => {
                const interpreter = ['${userHome}/bin/python'];
                const result = resolveVariables(
                    ['${interpreter}', '--check'],
                    workspace,
                    interpreter,
                );
                assert.deepStrictEqual(result, [`${home}/bin/python`, '--check']);
            });

            test('leaves ${interpreter} literal when no interpreter provided', () => {
                const result = resolveVariables(['${interpreter}'], workspace);
                assert.deepStrictEqual(result, ['${interpreter}']);
            });
        });

        test('multiple variables in a single string', () => {
            const result = resolveVariables(
                ['${userHome}/${workspaceFolder}/build'],
                workspace,
            );
            assert.deepStrictEqual(result, [`${home}/${workspace.uri.fsPath}/build`]);
        });

        test('resolves all variables in a realistic args array', () => {
            const interpreter = [`${home}/bin/python`];
            const result = resolveVariables(
                [
                    '${userHome}',
                    '${workspaceFolder}',
                    '${workspaceFolder:my-project}',
                    '${cwd}',
                ],
                workspace,
                interpreter,
            );
            assert.deepStrictEqual(result, [
                home,
                workspace.uri.fsPath,
                workspace.uri.fsPath,
                cwd,
            ]);
        });

        test('resolves all variables in a realistic path array with ${interpreter}', () => {
            const interpreter = [`${home}/bin/python`];
            const result = resolveVariables(
                [
                    '${userHome}/bin/tool',
                    '${workspaceFolder}/bin/tool',
                    '${workspaceFolder:my-project}/bin/tool',
                    '${cwd}/bin/tool',
                    '${interpreter}',
                ],
                workspace,
                interpreter,
            );
            assert.deepStrictEqual(result, [
                `${home}/bin/tool`,
                `${workspace.uri.fsPath}/bin/tool`,
                `${workspace.uri.fsPath}/bin/tool`,
                `${cwd}/bin/tool`,
                `${home}/bin/python`,
            ]);
        });

        test('no workspace leaves ${workspaceFolder} unresolved', () => {
            const result = resolveVariables(['${workspaceFolder}/src'], undefined);
            assert.deepStrictEqual(result, ['${workspaceFolder}/src']);
        });

        test('empty input returns empty output', () => {
            assert.deepStrictEqual(resolveVariables([], workspace), []);
        });

        test('strings without variables pass through unchanged', () => {
            const result = resolveVariables(['--check', '--diff', 'file.py'], workspace);
            assert.deepStrictEqual(result, ['--check', '--diff', 'file.py']);
        });

        test('replaces multiple occurrences of same variable in one string', () => {
            const result = resolveVariables(
                ['${workspaceFolder}/src:${workspaceFolder}/lib'],
                workspace,
            );
            assert.deepStrictEqual(result, [
                `${workspace.uri.fsPath}/src:${workspace.uri.fsPath}/lib`,
            ]);
        });

        test('uses multiple workspace folders for named resolution', () => {
            const ws1 = makeWorkspace('frontend', '/repos/frontend', 0);
            const ws2 = makeWorkspace('backend', '/repos/backend', 1);
            getWorkspaceFoldersStub.returns([ws1, ws2]);

            const result = resolveVariables(
                ['${workspaceFolder:frontend}/src', '${workspaceFolder:backend}/api'],
                ws1,
            );
            assert.deepStrictEqual(result, ['/repos/frontend/src', '/repos/backend/api']);
        });
    });

    // ── expandTilde ───────────────────────────────────────────────────

    suite('expandTilde', () => {
        const cases: [string, string, string][] = [
            ['bare ~', '~', home],
            ['~/ prefix', '~/documents', path.join(home, 'documents')],
            ['~\\ prefix', '~\\documents', path.join(home, 'documents')],
            ['no tilde', '/absolute/path', '/absolute/path'],
            ['mid-string tilde', '/home/~/file', '/home/~/file'],
            ['tilde not at start', 'path/~/other', 'path/~/other'],
            ['empty string', '', ''],
        ];

        cases.forEach(([label, input, expected]) => {
            test(label, () => {
                assert.strictEqual(expandTilde(input), expected);
            });
        });
    });

    // ── resolvePathSetting ────────────────────────────────────────────

    suite('resolvePathSetting', () => {
        test('resolves ${workspaceFolder} in path', () => {
            const result = resolvePathSetting('${workspaceFolder}/.env', workspace);
            assert.strictEqual(result, `${workspace.uri.fsPath}/.env`);
        });

        test('resolves ${userHome} absolute path', () => {
            const result = resolvePathSetting('${userHome}/tools/bin', workspace);
            assert.strictEqual(result, `${home}/tools/bin`);
        });

        test('makes relative path absolute against workspace', () => {
            const result = resolvePathSetting('configs/.env', workspace);
            assert.strictEqual(result, path.join(workspace.uri.fsPath, 'configs/.env'));
        });

        test('expands tilde in path', () => {
            const result = resolvePathSetting('~/.config/tool.ini', workspace);
            assert.strictEqual(result, path.join(home, '.config/tool.ini'));
        });
    });
});
