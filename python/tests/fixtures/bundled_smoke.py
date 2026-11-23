# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Executed with -I so environment paths and the checkout cannot supply the package."""

import importlib
import importlib.metadata
import json
import pathlib
import sys

target = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, str(target))
package = importlib.import_module("vscode_common_python_lsp")
assert pathlib.Path(package.__file__).resolve().is_relative_to(target)
distribution = importlib.metadata.distribution("vscode-python-tool-internal")
assert distribution.locate_file("").resolve() == target
assert distribution.version

runner = importlib.import_module("vscode_common_python_lsp.runner")
assert pathlib.Path(runner.__file__).resolve().is_relative_to(target)
result = runner.run_module(
    "json.tool",
    ["json.tool"],
    use_stdin=True,
    cwd=str(target.parent),
    source='{"message": "héllo 日本語"}',
)
assert json.loads(result.stdout) == {"message": "héllo 日本語"}
assert result.stderr == ""
assert result.exit_code in (None, 0)
