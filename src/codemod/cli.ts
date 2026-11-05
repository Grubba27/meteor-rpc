#!/usr/bin/env node
/// <reference types="node" />
// Entry point of the `meteor-rpc-migrate` bin (see MIGRATION.md, "Automated migration").
// TypeScript is only a devDependency of meteor-rpc, so it's loaded here at runtime: first the
// app's own copy (resolved from the working directory), then one installed next to meteor-rpc,
// e.g. by `npx -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate`.
import { createRequire } from "node:module";
import * as path from "node:path";
import type { TypeScript } from "./ast.js";
import { main } from "./main.js";

function loadTypeScript(): TypeScript | undefined {
  const loaders = [
    () => createRequire(path.join(process.cwd(), "package.json"))("typescript"),
    () => require("typescript"),
  ];
  for (const load of loaders) {
    let ts: Partial<TypeScript> | undefined;
    try {
      ts = load();
    } catch {
      continue;
    }
    // TypeScript 7 has no JavaScript API, and TypeScript 4 lacks syntax the codemod relies on.
    const major = Number(String(ts?.versionMajorMinor ?? "0").split(".")[0]);
    if (typeof ts?.createSourceFile === "function" && major >= 5) return ts as TypeScript;
  }
  return undefined;
}

try {
  process.exitCode = main(
    process.argv.slice(2),
    {
      cwd: process.cwd(),
      color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    loadTypeScript,
  );
} catch (error) {
  process.stderr.write(
    `meteor-rpc-migrate crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n` +
      "Please report it at https://github.com/Grubba27/meteor-rpc/issues\n",
  );
  process.exitCode = 1;
}
