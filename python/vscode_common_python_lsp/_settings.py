# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Private, stateless settings construction for the ToolServer facade."""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .server import ToolServerConfig


def get_global_defaults(
    config: ToolServerConfig, global_settings: dict[str, Any]
) -> dict[str, Any]:
    """Build fresh defaults while retaining the configured value objects."""
    base: dict[str, Any] = {
        "path": global_settings.get("path", []),
        "interpreter": global_settings.get("interpreter", [sys.executable]),
        "args": global_settings.get("args", []),
        "importStrategy": global_settings.get("importStrategy", "useBundled"),
        "showNotifications": global_settings.get(
            "showNotifications", config.default_notification_level
        ),
    }
    if "_toolEnabled" in global_settings:
        base["_toolEnabled"] = global_settings["_toolEnabled"]
    for key, default in config.default_settings.items():
        base[key] = global_settings.get(key, default)
    # Hardcoded settings ignore whatever the client sent in GLOBAL_SETTINGS.
    base.update(config.hardcoded_settings)
    return base


def get_fallback_settings(
    workspace_fs: str, workspace_uri: str, defaults: dict[str, Any]
) -> dict[str, Any]:
    """Use contextual paths unless the configured defaults supply those keys."""
    return {
        "cwd": workspace_fs,
        "workspaceFS": workspace_fs,
        "workspace": workspace_uri,
        **defaults,
    }


def get_workspace_settings(
    workspace_fs: str, defaults: dict[str, Any], settings: dict[str, Any]
) -> dict[str, Any]:
    """Shallowly overlay client settings, keeping the normalized workspace path."""
    return {**defaults, **settings, "workspaceFS": workspace_fs}
