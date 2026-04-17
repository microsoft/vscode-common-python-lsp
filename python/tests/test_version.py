# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.version."""

from vscode_common_python_lsp.version import (
    check_min_version,
    extract_version,
    version_to_tuple,
)

# ---------------------------------------------------------------------------
# extract_version
# ---------------------------------------------------------------------------


class TestExtractVersion:
    def test_flake8_output(self):
        stdout = (
            "5.0.4 (mccabe: 0.7.0, pycodestyle: 2.9.1, pyflakes: 2.5.0) CPython 3.8.7\n"
        )
        assert extract_version(stdout) == "5.0.4"

    def test_black_output(self):
        stdout = "black, 22.3.0 (compiled: yes)\n"
        assert extract_version(stdout) == "22.3.0"

    def test_isort_output(self):
        stdout = "5.10.1\n"
        assert extract_version(stdout) == "5.10.1"

    def test_mypy_output(self):
        stdout = "mypy 1.0.0 (compiled: yes)\n"
        assert extract_version(stdout) == "1.0.0"

    def test_pylint_output(self):
        stdout = "pylint 2.12.2\nastroid 2.9.3\n"
        # Default regex picks the first \d+.\d+ match
        assert extract_version(stdout) == "2.12.2"

    def test_empty_stdout(self):
        assert extract_version("") is None
        assert extract_version("   ") is None

    def test_none_stdout(self):
        assert extract_version(None) is None

    def test_custom_parser(self):
        def parse_pylint(stdout: str) -> str | None:
            return stdout.splitlines()[0].split(" ")[1]

        stdout = "pylint 2.12.2\n"
        assert extract_version(stdout, parser=parse_pylint) == "2.12.2"

    def test_no_version_in_output(self):
        assert extract_version("no version here\n") is None


# ---------------------------------------------------------------------------
# check_min_version
# ---------------------------------------------------------------------------


class TestCheckMinVersion:
    def test_equal(self):
        assert check_min_version("5.0.0", "5.0.0") is True

    def test_above(self):
        assert check_min_version("5.1.0", "5.0.0") is True

    def test_below(self):
        assert check_min_version("4.9.9", "5.0.0") is False

    def test_major_above(self):
        assert check_min_version("6.0.0", "5.0.0") is True

    def test_invalid_version(self):
        assert check_min_version("not_a_version", "5.0.0") is False


# ---------------------------------------------------------------------------
# version_to_tuple
# ---------------------------------------------------------------------------


class TestVersionToTuple:
    def test_basic(self):
        assert version_to_tuple("5.10.1") == (5, 10, 1)

    def test_two_part(self):
        assert version_to_tuple("22.3.0") == (22, 3, 0)

    def test_pre_release(self):
        major, minor, micro = version_to_tuple("1.0.0rc1")
        assert (major, minor, micro) == (1, 0, 0)
