# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.

import vscode_common_python_lsp


def test_package_importable():
    """Verify the package is importable."""
    assert hasattr(vscode_common_python_lsp, "classify_python_file")
