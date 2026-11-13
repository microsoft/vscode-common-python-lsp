# Shared TypeScript source

Shared TypeScript utilities for VS Code Python tool extensions.

Build this directory from a pinned repository checkout and import its `dist`
public entry point by a source-relative path. The private manifest name
`vscode-python-tool-internal` is only local build metadata, not a
published package or a supported bare-module import.

See the [main README](../README.md#consuming-in-extensions) for build order,
consumer type-checking and bundling instructions.
