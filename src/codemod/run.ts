/// <reference types="node" />
// File system side of the codemod: finds the source files under the given paths, gives the
// project access to the disk (to follow imports to files outside those paths too), runs the
// transform on every file and writes the results.
import * as fs from "node:fs";
import * as path from "node:path";
import type { TypeScript } from "./ast.js";
import { createProject, type ProjectHost } from "./project.js";
import { type TransformResult, transform } from "./transform.js";

export const SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".meteor",
  "dist",
  "build",
  ".git",
]);

export interface SourceFiles {
  /** Absolute file names, sorted, without duplicates. */
  readonly files: readonly string[];
  /** Given paths that don't exist. */
  readonly missing: readonly string[];
  /** Given files that aren't JavaScript or TypeScript. */
  readonly ignored: readonly string[];
}

export interface FileResult {
  readonly fileName: string;
  readonly source: string;
  readonly result: TransformResult;
}

const isSourceFile = (fileName: string) =>
  SOURCE_EXTENSIONS.some((extension) => fileName.endsWith(extension));

/** Walks files and directories (absolute paths), skipping node_modules, .meteor, dist, build and .git. */
export function findSourceFiles(paths: readonly string[]): SourceFiles {
  const files = new Set<string>();
  const missing: string[] = [];
  const ignored: string[] = [];
  const walk = (directory: string) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      // Symbolic links are skipped: they could loop, and usually point outside the app.
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) walk(fullPath);
      else if (entry.isFile() && isSourceFile(entry.name)) files.add(fullPath);
    }
  };
  for (const given of paths) {
    const stat = fs.statSync(given, { throwIfNoEntry: false });
    if (!stat) missing.push(given);
    else if (stat.isDirectory()) walk(given);
    else if (isSourceFile(given)) files.add(given);
    else ignored.push(given);
  }
  return { files: [...files].sort(), missing, ignored };
}

/** Reads from disk, with caches. The app root is the nearest directory with .meteor/ or package.json. */
export function nodeHost(): ProjectHost {
  const contents = new Map<string, string | undefined>();
  const roots = new Map<string, string | undefined>();
  const exists = (target: string) => fs.existsSync(target);
  const findRoot = (directory: string): string | undefined => {
    if (roots.has(directory)) return roots.get(directory);
    const parent = path.dirname(directory);
    const root =
      exists(path.join(directory, ".meteor")) || exists(path.join(directory, "package.json"))
        ? directory
        : parent === directory
          ? undefined
          : findRoot(parent);
    roots.set(directory, root);
    return root;
  };
  return {
    fileExists: (fileName) => fs.statSync(fileName, { throwIfNoEntry: false })?.isFile() ?? false,
    readFile(fileName) {
      if (!contents.has(fileName)) {
        let text: string | undefined;
        try {
          text = fs.readFileSync(fileName, "utf8");
        } catch {
          text = undefined;
        }
        contents.set(fileName, text);
      }
      return contents.get(fileName);
    },
    appRoot: (fileName) => findRoot(path.dirname(fileName)),
  };
}

/** Transforms every file. Nothing is written. */
export function migrateFiles(
  fileNames: readonly string[],
  ts: TypeScript,
  host: ProjectHost = nodeHost(),
): FileResult[] {
  const project = createProject(ts, host);
  const results: FileResult[] = [];
  for (const fileName of fileNames) {
    const source = host.readFile(fileName);
    if (source === undefined) continue;
    results.push({ fileName, source, result: transform(fileName, source, ts, project) });
  }
  return results;
}

/** Writes the files that changed. Returns how many were written. */
export function writeResults(results: readonly FileResult[]): number {
  let written = 0;
  for (const { fileName, source, result } of results) {
    if (result.output === source) continue;
    fs.writeFileSync(fileName, result.output);
    written++;
  }
  return written;
}
