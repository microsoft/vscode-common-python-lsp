# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import vscode_common_python_lsp


def test_package_version():
    """Verify the package is importable and has a version."""
    assert vscode_common_python_lsp.__version__ == "0.1.0"
