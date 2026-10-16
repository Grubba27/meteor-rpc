/// <reference types="node" />
// Command line of `meteor-rpc-migrate`: parses arguments, runs the codemod over the given paths
// and prints a diff and report (or JSON). Separate from cli.ts so tests can run it with a fake
// terminal and an already loaded TypeScript.
import * as path from "node:path";
import type { TypeScript } from "./ast.js";
import { type FileReport, formatReport, toJson } from "./report.js";
import { findSourceFiles, migrateFiles, writeResults } from "./run.js";

export const USAGE = `Usage: meteor-rpc-migrate [--write] [--json] [--check] <paths...>

Migrates code using meteor-rpc 1.x to 2.0. Without --write it only prints what it would change.

  --write   apply the changes
  --json    print the findings as JSON: [{ file, line, column, kind, message, anchor }]
  --check   exit with code 1 when something needs changing (for CI)
  --help    show this help

Run it once, on 1.x code: a second run would turn 2.0 api.x.useQuery() calls into useSuspenseQuery().
Guide: https://github.com/Grubba27/meteor-rpc/blob/main/MIGRATION.md
`;

export const NO_TYPESCRIPT = `meteor-rpc-migrate needs the JavaScript API of TypeScript 5 to read your files, and couldn't load it.
TypeScript 7 (tsgo) has no JavaScript API. Run the codemod with TypeScript 5.9 from npx:

  npx -y -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate <paths...>
`;

export interface CliOptions {
  readonly write: boolean;
  readonly json: boolean;
  readonly check: boolean;
  readonly help: boolean;
  readonly paths: readonly string[];
}

/** Where the CLI prints, and the directory relative paths start from. */
export interface CliIo {
  readonly cwd: string;
  readonly color: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** Parses arguments, or returns an error message. */
export function parseArgs(argv: readonly string[]): CliOptions | string {
  let write = false;
  let json = false;
  let check = false;
  let help = false;
  const paths: string[] = [];
  let onlyPaths = false;
  for (const arg of argv) {
    if (onlyPaths || !arg.startsWith("-")) paths.push(arg);
    else if (arg === "--") onlyPaths = true;
    else if (arg === "--write" || arg === "-w") write = true;
    else if (arg === "--json") json = true;
    else if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else return `Unknown option ${arg}`;
  }
  return { write, json, check, help, paths };
}

/** Runs the CLI and returns the exit code: 0, 1 for --check with findings, 2 for usage errors. */
export function main(
  argv: readonly string[],
  io: CliIo,
  loadTypeScript: () => TypeScript | undefined,
): number {
  const options = parseArgs(argv);
  if (typeof options === "string") {
    io.stderr(`${options}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (options.paths.length === 0) {
    io.stderr(USAGE);
    return 2;
  }
  const ts = loadTypeScript();
  if (!ts) {
    io.stderr(NO_TYPESCRIPT);
    return 2;
  }

  const sources = findSourceFiles(options.paths.map((given) => path.resolve(io.cwd, given)));
  for (const missing of sources.missing)
    io.stderr(`meteor-rpc-migrate: ${missing} doesn't exist\n`);
  for (const ignored of sources.ignored) {
    io.stderr(`meteor-rpc-migrate: skipping ${ignored}: not a JavaScript or TypeScript file\n`);
  }
  if (sources.missing.length === options.paths.length) return 2;

  const results = migrateFiles(sources.files, ts);
  if (options.write) writeResults(results);

  const reports: FileReport[] = results.map(({ fileName, source, result }) => ({
    displayName: path.relative(io.cwd, fileName).split(path.sep).join("/") || fileName,
    source,
    result,
  }));
  if (options.json) {
    io.stdout(`${JSON.stringify(toJson(reports), null, 2)}\n`);
  } else {
    io.stdout(
      formatReport(reports, {
        write: options.write,
        color: io.color,
        scanned: sources.files.length,
      }),
    );
  }
  const pending = results.some(
    ({ result }) => result.changes.length > 0 || result.manual.length > 0,
  );
  return options.check && pending ? 1 : 0;
}
