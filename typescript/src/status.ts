// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { LanguageStatusItem, Disposable, l10n, LanguageStatusSeverity } from 'vscode';
import { Command } from 'vscode-languageclient';
import { createLanguageStatusItem } from './vscodeapi';
import { getDocumentSelector } from './utilities';

let _status: LanguageStatusItem | undefined;
export function registerLanguageStatusItem(id: string, name: string, command: string): Disposable {
    _status?.dispose();

    const status = createLanguageStatusItem(id, getDocumentSelector());
    _status = status;
    status.name = name;
    status.text = name;
    status.command = Command.create(l10n.t('Open logs'), command);

    return {
        dispose: () => {
            status.dispose();
            if (_status === status) {
                _status = undefined;
            }
        },
    };
}

export function updateStatus(
    status: string | undefined,
    severity: LanguageStatusSeverity,
    busy?: boolean,
    detail?: string,
): void {
    if (_status) {
        _status.text = status && status.length > 0 ? `${_status.name}: ${status}` : `${_status.name}`;
        _status.severity = severity;
        _status.busy = busy ?? false;
        _status.detail = detail;
    }
}
