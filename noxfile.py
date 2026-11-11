# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Build and test automation for vscode-common-python-lsp."""

import nox


@nox.session()
def install(session: nox.Session) -> None:
    """Install the package in development mode."""
    session.install("-e", "./python[dev]")


@nox.session()
def tests(session: nox.Session) -> None:
    """Run Python tests."""
    session.install("-e", "./python[dev]")
    session.run("pytest", "python/tests", "-v")


@nox.session()
def lint(session: nox.Session) -> None:
    """Run linters and formatters on Python code."""
    session.install("-e", "./python[dev]")

    session.run("flake8", "python/vscode_common_python_lsp")
    session.run("flake8", "python/tests")

    session.run("black", "--check", "python/vscode_common_python_lsp")
    session.run("black", "--check", "python/tests")

    session.run("isort", "--check", "python/vscode_common_python_lsp")
    session.run("isort", "--check", "python/tests")
