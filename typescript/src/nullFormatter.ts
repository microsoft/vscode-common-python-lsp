// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { Disposable } from 'vscode';
import { traceLog } from './logging';
import { getDocumentSelector } from './utilities';
import { registerDocumentFormattingEditProvider } from './vscodeapi';

/**
 * Lifecycle-aware placeholder DocumentFormattingEditProvider.
 *
 * A tool extension that provides LSP-based formatting needs to appear in
 * VS Code's formatter picker *before* the language client has finished
 * starting, otherwise the first "Format Document" invocation after
 * activation is treated as "no formatter installed".
 *
 * This helper registers a no-op provider for `getDocumentSelector()` and
 * lets callers dispose it (typically as soon as the real LSP provider takes
 * over).
 *
 * **Important:** never leave both the placeholder and the LSP provider
 * registered at the same time — VS Code will show the extension twice in
 * the formatter picker (one entry per provider). The shared activation
 * pattern in `activation.ts` handles this automatically when
 * `ToolConfig.isFormatter` is `true`.
 */
export class NullFormatter implements Disposable {
    private disposable: Disposable | undefined;

    /** No-op if already registered. */
    register(): void {
        if (this.disposable) {
            return;
        }
        this.disposable = registerDocumentFormattingEditProvider(getDocumentSelector(), {
            provideDocumentFormattingEdits: () => {
                traceLog('Formatting requested before server has started.');
                return Promise.resolve(undefined);
            },
        });
    }

    /** No-op if not registered. */
    unregister(): void {
        if (!this.disposable) {
            return;
        }
        try {
            this.disposable.dispose();
        } finally {
            this.disposable = undefined;
        }
    }

    /** True iff the placeholder is currently registered. */
    isRegistered(): boolean {
        return this.disposable !== undefined;
    }

    dispose(): void {
        this.unregister();
    }
}
