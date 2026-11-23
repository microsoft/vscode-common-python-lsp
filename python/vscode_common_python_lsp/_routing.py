# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License.
"""Private, stateless workspace/document routing for the ToolServer facade."""

from __future__ import annotations

import os
import pathlib
from collections.abc import Callable
from types import ModuleType
from typing import TYPE_CHECKING, Any

from pygls.workspace import TextDocument

from . import _settings

if TYPE_CHECKING:
    from .server import ToolServer


def update_workspace_settings(
    facade: ToolServer,
    settings: list[dict[str, Any]] | None,
    *,
    normalize_path: Callable[..., str],
    uris: ModuleType,
) -> None:
    """Populate the facade's current workspace dictionary in place."""
    if not settings:
        key = normalize_path(
            os.getcwd(), resolve_symlinks=facade.config.resolve_symlinks
        )
        facade.workspace_settings[key] = _settings.get_fallback_settings(
            key, uris.from_fs_path(key), facade.get_global_defaults()
        )
        return

    for setting in settings:
        workspace_path = uris.to_fs_path(setting["workspace"])
        # Virtual workspace roots, such as "pico:", have no local
        # filesystem path, so they cannot be registered here.
        if workspace_path is None:
            continue

        key = normalize_path(
            workspace_path,
            resolve_symlinks=facade.config.resolve_symlinks,
        )
        facade.workspace_settings[key] = _settings.get_workspace_settings(
            key, facade.get_global_defaults(), setting
        )


def get_settings_by_path(
    facade: ToolServer,
    file_path: pathlib.Path,
    *,
    normalize_path: Callable[..., str],
    uris: ModuleType,
) -> dict[str, Any]:
    """Select workspace settings, falling back to CWD or the first workspace."""
    if not facade.workspace_settings:
        cwd = normalize_path(
            os.getcwd(), resolve_symlinks=facade.config.resolve_symlinks
        )
        return _settings.get_fallback_settings(
            cwd, uris.from_fs_path(cwd), facade.get_global_defaults()
        )

    workspaces = {s["workspaceFS"] for s in facade.workspace_settings.values()}

    while file_path != file_path.parent:
        str_file_path = normalize_path(
            str(file_path), resolve_symlinks=facade.config.resolve_symlinks
        )
        if str_file_path in workspaces:
            return facade.workspace_settings[str_file_path]
        file_path = file_path.parent

    return list(facade.workspace_settings.values())[0]


def get_document_key(
    facade: ToolServer,
    document: TextDocument,
    *,
    normalize_path: Callable[..., str],
) -> str | None:
    """Find the nearest workspace key without a first-workspace fallback."""
    if facade.workspace_settings:
        document_workspace = pathlib.Path(document.path)
        workspaces = {s["workspaceFS"] for s in facade.workspace_settings.values()}
        opted_in = any("_toolEnabled" in s for s in facade.workspace_settings.values())
        workspace_keys = None
        if opted_in:
            workspace_keys = {
                pathlib.Path(s["workspaceFS"]): s["workspaceFS"]
                for s in facade.workspace_settings.values()
            }
        # A relative path's terminal "." must not resolve to a CWD workspace.
        include_filesystem_root = opted_in and document_workspace.is_absolute()
        if include_filesystem_root:
            # Walk the normalized path's ancestors, including any symlink target.
            document_workspace = pathlib.Path(
                normalize_path(
                    str(document_workspace),
                    resolve_symlinks=facade.config.resolve_symlinks,
                )
            )

        while (
            include_filesystem_root or document_workspace != document_workspace.parent
        ):
            norm_path = (
                str(document_workspace)
                if include_filesystem_root
                else normalize_path(
                    str(document_workspace),
                    resolve_symlinks=facade.config.resolve_symlinks,
                )
            )
            key = (
                workspace_keys.get(pathlib.Path(norm_path))
                if workspace_keys is not None
                else norm_path
            )
            if key in workspaces:
                return key
            if document_workspace == document_workspace.parent:
                break
            document_workspace = document_workspace.parent

    return None


def get_settings_by_document(
    facade: ToolServer,
    document: TextDocument | None,
    *,
    normalize_path: Callable[..., str],
    uris: ModuleType,
) -> dict[str, Any]:
    """Select settings, retaining the distinct absent/outside-document fallbacks."""
    if document is None or document.path is None:
        if not facade.workspace_settings:
            cwd = normalize_path(
                os.getcwd(), resolve_symlinks=facade.config.resolve_symlinks
            )
            return _settings.get_fallback_settings(
                cwd, uris.from_fs_path(cwd), facade.get_global_defaults()
            )
        return list(facade.workspace_settings.values())[0]

    key = facade.get_document_key(document)
    if key is not None:
        return facade.workspace_settings[key]

    key = normalize_path(
        str(pathlib.Path(document.path).parent),
        resolve_symlinks=facade.config.resolve_symlinks,
    )
    return _settings.get_fallback_settings(
        key, uris.from_fs_path(key), facade.get_global_defaults()
    )
