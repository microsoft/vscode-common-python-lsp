# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Lint request tracking for stale-result deduplication.

When multiple ``didSave`` events fire in quick succession each one spawns
a tool process.  Only the **latest** result should be published — earlier
runs are stale.  This module provides :class:`LintRequestTracker` which
manages a per-URI version counter protected by a threading lock.

Shared by flake8, mypy, and pylint (formatters don't need this).
"""

from __future__ import annotations

import threading


class LintRequestTracker:
    """Thread-safe version counter for lint request deduplication.

    Usage::

        tracker = LintRequestTracker()

        # At the start of a lint run:
        version = tracker.increment(uri)

        # ... run tool, parse output ...

        # Before publishing diagnostics:
        if tracker.is_current(uri, version):
            publish_diagnostics(...)
    """

    def __init__(self) -> None:
        self._versions: dict[str, int] = {}
        self._lock = threading.Lock()

    def increment(self, uri: str) -> int:
        """Bump and return the version for *uri*."""
        with self._lock:
            version = self._versions.get(uri, 0) + 1
            self._versions[uri] = version
            return version

    def is_current(self, uri: str, version: int) -> bool:
        """Return *True* if *version* is still the latest for *uri*."""
        with self._lock:
            if uri not in self._versions:
                return False
            return self._versions[uri] == version

    def reset(self, uri: str | None = None) -> None:
        """Reset version counters.

        When *uri* is ``None`` all counters are cleared.
        """
        with self._lock:
            if uri is None:
                self._versions.clear()
            else:
                self._versions.pop(uri, None)
