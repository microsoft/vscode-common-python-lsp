// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { assert } from "chai";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";

suite("TypeScript build", () => {
  test("removes obsolete JavaScript and declarations before compiling", function () {
    this.timeout(60_000);
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      throw new Error("Run this test using npm test.");
    }
    const root = path.resolve(__dirname, "..", "..");
    const dist = path.join(root, "dist");
    mkdirSync(dist, { recursive: true });
    const stale = mkdtempSync(path.join(dist, "stale-build-"));
    writeFileSync(path.join(stale, "removed.js"), "module.exports = {};\n");
    writeFileSync(path.join(stale, "removed.d.ts"), "export {};\n");
    try {
      execFileSync(process.execPath, [npmCli, "run", "build"], {
        cwd: root,
        timeout: 60_000,
        stdio: "pipe",
      });
      assert.isFalse(
        existsSync(stale),
        "Outputs for removed sources must not survive the build",
      );
      assert.isTrue(existsSync(path.join(dist, "index.js")));
      assert.isTrue(existsSync(path.join(dist, "index.d.ts")));
    } finally {
      rmSync(stale, { recursive: true, force: true });
    }
  });
});
