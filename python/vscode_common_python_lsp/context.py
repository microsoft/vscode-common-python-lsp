# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Context managers for use with running tools over LSP."""

from __future__ import annotations

import contextlib
import logging
import os
import sys
from typing import Any

from .paths import SERVER_CWD


@contextlib.contextmanager
def substitute_attr(obj: Any, attribute: str, new_value: Any):
    """Manage object attributes context when using runpy.run_module()."""
    old_value = getattr(obj, attribute)
    setattr(obj, attribute, new_value)
    yield
    setattr(obj, attribute, old_value)


@contextlib.contextmanager
def redirect_io(stream: str, new_stream):
    """Redirect stdio streams to a custom stream."""
    old_stream = getattr(sys, stream)
    setattr(sys, stream, new_stream)
    yield
    setattr(sys, stream, old_stream)


@contextlib.contextmanager
def change_cwd(new_cwd):
    """Change working directory before running code."""
    try:
        os.chdir(new_cwd)
    except OSError as e:
        logging.warning(
            "Failed to change directory to %r, running in %r instead: %s",
            new_cwd,
            SERVER_CWD,
            e,
        )
        yield
        return
    try:
        yield
    finally:
        os.chdir(SERVER_CWD)
