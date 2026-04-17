# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Tests for vscode_common_python_lsp.linting."""

import threading

from vscode_common_python_lsp.linting import LintRequestTracker


class TestLintRequestTracker:
    def test_increment_starts_at_1(self):
        tracker = LintRequestTracker()
        assert tracker.increment("file:///a.py") == 1

    def test_increment_monotonic(self):
        tracker = LintRequestTracker()
        v1 = tracker.increment("file:///a.py")
        v2 = tracker.increment("file:///a.py")
        v3 = tracker.increment("file:///a.py")
        assert v1 < v2 < v3

    def test_is_current_after_increment(self):
        tracker = LintRequestTracker()
        v = tracker.increment("file:///a.py")
        assert tracker.is_current("file:///a.py", v) is True

    def test_is_current_stale(self):
        tracker = LintRequestTracker()
        v1 = tracker.increment("file:///a.py")
        tracker.increment("file:///a.py")  # v2 supersedes v1
        assert tracker.is_current("file:///a.py", v1) is False

    def test_independent_uris(self):
        tracker = LintRequestTracker()
        va = tracker.increment("file:///a.py")
        vb = tracker.increment("file:///b.py")
        assert tracker.is_current("file:///a.py", va) is True
        assert tracker.is_current("file:///b.py", vb) is True

    def test_reset_specific_uri(self):
        tracker = LintRequestTracker()
        tracker.increment("file:///a.py")
        vb = tracker.increment("file:///b.py")
        tracker.reset("file:///a.py")
        # a.py reset — next increment starts fresh
        assert tracker.increment("file:///a.py") == 1
        # b.py unaffected
        assert tracker.is_current("file:///b.py", vb) is True

    def test_reset_all(self):
        tracker = LintRequestTracker()
        tracker.increment("file:///a.py")
        tracker.increment("file:///b.py")
        tracker.reset()
        assert tracker.increment("file:///a.py") == 1
        assert tracker.increment("file:///b.py") == 1

    def test_is_current_unknown_uri(self):
        tracker = LintRequestTracker()
        assert tracker.is_current("file:///unknown.py", 1) is False

    def test_thread_safety(self):
        tracker = LintRequestTracker()
        results: list[int] = []

        def increment_many():
            for _ in range(100):
                results.append(tracker.increment("file:///a.py"))

        threads = [threading.Thread(target=increment_many) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(results) == 400
        # All versions should be unique (no duplicates from race conditions)
        assert len(set(results)) == 400
