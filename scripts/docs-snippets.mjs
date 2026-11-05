#!/usr/bin/env node
// Type-checks the ```ts and ```tsx blocks of README.md and docs/*.md against the packed library,
// so the documentation's examples keep compiling.
//
//   node scripts/docs-snippets.mjs                  README.md and docs/*.md
//   node scripts/docs-snippets.mjs docs/react.md    only these Markdown files
//   node scripts/docs-snippets.mjs --skip-build     reuse dist/ (still packs)
//
// Env: DOCS_SNIPPETS_DIR (work dir, default: <os tmp>/meteor-rpc-docs-snippets).
//
// Every Markdown file becomes a small app: a directory holding the fixtures of
// scripts/docs-snippets/ and one file per code block. Like a Meteor app, "/imports/..." resolves
// from its root, and `meteor/*` resolves to @types/meteor.
// - A block whose first line is a path comment (`// imports/api/server.ts`) is a whole file. It's
//   written to that path, replacing any fixture there, and must compile as it is.
// - Any other block is a fragment, written to a file of its own. It gets an import of the names it
//   uses but doesn't declare from scripts/docs-snippets/__docs__/prelude.ts (`api`, `createModule`,
//   `z`, collections, ...). A fragment starting with `.` continues a builder: it's checked as
//   `createModule()` followed by the fragment.
// - A one-line `.addMethod(name, schema, resolver, config?)` signature is skipped, and so is a
//   block preceded by the line `<!-- docs-snippets: skip -->`.
//
// A block fails on any TypeScript error in its file (strict mode, as in Meteor's TypeScript
// skeleton). Errors are reported at their line in the Markdown file. Exits non-zero on any failure.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "scripts", "docs-snippets");
const workDir = path.resolve(
  process.env.DOCS_SNIPPETS_DIR ?? path.join(os.tmpdir(), "meteor-rpc-docs-snippets"),
);
if (workDir === path.parse(workDir).root || workDir === os.homedir() || workDir === repoRoot) {
  throw new Error(`DOCS_SNIPPETS_DIR must be a dedicated directory, got ${workDir}`);
}
const projectDir = path.join(workDir, "project");

// The versions examples/basic uses, so the docs and the example app agree.
const DEPENDENCIES = {
  "@tanstack/react-query": "5.104.3",
  "@types/meteor": "2.9.11",
  "@types/node": "22.20.5",
  "@types/react": "19.3.0",
  react: "19.2.0",
  typescript: "5.9.3",
  valibot: "1.5.0",
  zod: "4.6.7",
};

const COMPILER_OPTIONS = {
  target: "es2022",
  lib: ["es2022", "dom"],
  module: "preserve",
  moduleResolution: "bundler",
  moduleDetection: "force", // every block is a module, even without import/export
  jsx: "react-jsx",
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  types: ["node"],
  paths: {
    "/*": ["./*"],
    "meteor/*": ["../../node_modules/@types/meteor/*"],
    "@acme/billing-api": ["./__docs__/billing.ts"],
  },
};

const LANGUAGES = new Set(["ts", "tsx", "typescript"]);
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/;
const SKIP_MARKER = /^\s*<!--\s*docs-snippets:\s*skip\b/;
const PATH_COMMENT = /^\/\/\s*((?:[\w.-]+\/)*[\w.-]+\.tsx?)(?=\s|$)/;
const SIGNATURE = /^\.[\w.]+\(.*(?:\w\?|…).*\)$/;
const ERROR_LINE =
  /^(?<file>[^\s(][^(]*)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<message>.*)$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
    });
    let stdout = "";
    let output = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, output }));
  });
}

async function runOrThrow(command, args, cwd) {
  const result = await run(command, args, cwd);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}:\n${result.output}`);
  }
  return result.stdout;
}

/** Deletes a directory, refusing anything outside the work dir. */
function resetDir(dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(workDir + path.sep)) throw new Error(`refusing to delete ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
  fs.mkdirSync(resolved, { recursive: true });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/** How errors name a Markdown file: relative to the repository, or as given if outside it. */
function displayName(markdownFile) {
  const relative = path.relative(repoRoot, markdownFile);
  return relative.startsWith("..") ? path.relative(process.cwd(), markdownFile) : relative;
}

/** The ```ts / ```tsx blocks of a Markdown file. `line` is the 1-based line of its first code line. */
function extractSnippets(markdownFile) {
  const source = displayName(markdownFile);
  const lines = fs.readFileSync(markdownFile, "utf8").split(/\r?\n/);
  const snippets = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) continue;
    const [, indent, fence, language] = open;
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (LANGUAGES.has(language)) {
      const code = lines
        .slice(i + 1, end)
        .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
        .join("\n");
      const previous = lines
        .slice(0, i)
        .reverse()
        .find((line) => line.trim() !== "");
      snippets.push({
        source,
        line: i + 2,
        language: language === "tsx" ? "tsx" : "ts",
        code,
        skip: previous !== undefined && SKIP_MARKER.test(previous),
      });
    }
    i = end;
  }
  return snippets;
}

/** Local names of an import/export list: `a, type B, c as d` gives a, B, d. */
function specifierNames(list) {
  return list
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop(),
    )
    .filter(Boolean);
}

/** Names exported by the prelude fixture. */
function preludeExports() {
  const source = fs.readFileSync(path.join(fixtureRoot, "__docs__", "prelude.ts"), "utf8");
  const names = new Set();
  for (const match of source.matchAll(
    /^export\s+(?:declare\s+)?(?:const|let|function|class)\s+([\w$]+)/gm,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s+\{([^}]*)\}/gm)) {
    for (const name of specifierNames(match[1])) names.add(name);
  }
  for (const match of source.matchAll(/^export\s+\*\s+as\s+([\w$]+)/gm)) names.add(match[1]);
  return names;
}

/** Top-level names a block declares or imports (enough to avoid clashing with the prelude). */
function declaredNames(code) {
  const names = new Set();
  for (const match of code.matchAll(/^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']/gm)) {
    const clause = match[1].trim();
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const name of specifierNames(named[1])) names.add(name);
    const namespace = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (namespace) names.add(namespace[1]);
    const defaultImport = /^([\w$]+)\s*(?:,|$)/.exec(clause);
    if (defaultImport) names.add(defaultImport[1]);
  }
  for (const match of code.matchAll(
    /^(?:export\s+)?(?:declare\s+)?(?:const|let|var|function\*?|async\s+function|class|type|interface|enum|namespace)\s+([\w$]+)/gm,
  )) {
    names.add(match[1]);
  }
  // Top-level destructuring: `const { data: messages, isPending } = ...`
  for (const match of code.matchAll(/^(?:export\s+)?(?:const|let|var)\s+[{[]([^=]*)[}\]]\s*=/gm)) {
    for (const binding of match[1].matchAll(/([\w$]+)\s*(?=,|$|=)/g)) names.add(binding[1]);
  }
  return names;
}

/**
 * Decides where a block goes and what it needs. Returns the snippet with `status: "skip"`, or
 * with `file` (relative to the doc's app) and `header` (lines written before the code).
 */
function plan(snippet, taken, index, prelude) {
  if (snippet.skip) return { ...snippet, status: "skip", reason: "docs-snippets: skip" };
  const code = snippet.code.trim();
  if (!code.includes("\n") && SIGNATURE.test(code)) {
    return { ...snippet, status: "skip", reason: "signature" };
  }
  const firstLine = snippet.code.split("\n", 1)[0];
  const pathComment = PATH_COMMENT.exec(firstLine);
  if (pathComment && !taken.has(pathComment[1])) {
    taken.add(pathComment[1]);
    return { ...snippet, kind: "file", file: pathComment[1], header: [] };
  }
  const header = [];
  const firstCode = snippet.code.replace(/^(?:\s*\/\/.*\n)*/, "").trimStart();
  if (firstCode.startsWith(".")) header.push("export const builder = createModule()");
  const declared = declaredNames(snippet.code);
  // Identifiers outside strings and comments ("meteor-rpc/server" doesn't use `server`).
  const used = new Set(
    `${header.join("\n")}\n${snippet.code}`
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
      .replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")
      .match(/[A-Za-z_$][\w$]*/g),
  );
  const imports = [...prelude].filter((name) => used.has(name) && !declared.has(name)).sort();
  if (imports.length > 0)
    header.unshift(`import { ${imports.join(", ")} } from "/__docs__/prelude";`);
  return {
    ...snippet,
    kind: "fragment",
    file: `__snippets__/${String(index).padStart(2, "0")}.${snippet.language}`,
    header,
    imports,
  };
}

// ---------------------------------------------------------------------------
// Checking
// ---------------------------------------------------------------------------

const BARE_METEOR_IMPORT =
  /(?:from\s+|import\(\s*|require\(\s*)["']meteor\/|<reference\s+types=["']meteor["']/;

async function packLibrary(skipBuild) {
  if (!skipBuild) await runOrThrow("npm", ["run", "build", "--silent"], repoRoot);
  const packDir = path.join(workDir, "pack");
  resetDir(packDir);
  const json = await runOrThrow(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
    repoRoot,
  );
  const [{ filename, files }] = JSON.parse(json.slice(json.indexOf("[")));
  const offenders = files
    .filter(({ path: file }) => /\.d\.[cm]?ts$/.test(file))
    .filter(({ path: file }) =>
      BARE_METEOR_IMPORT.test(fs.readFileSync(path.join(repoRoot, file), "utf8")),
    );
  if (offenders.length > 0) {
    throw new Error(`published declarations import "meteor/*": ${offenders.map((f) => f.path)}`);
  }
  return path.join(packDir, filename);
}

async function installProject(tarball) {
  fs.mkdirSync(projectDir, { recursive: true });
  write(
    path.join(projectDir, "package.json"),
    `${JSON.stringify(
      {
        name: "meteor-rpc-docs-snippets",
        private: true,
        devDependencies: { "meteor-rpc": `file:${tarball}`, ...DEPENDENCIES },
      },
      null,
      2,
    )}\n`,
  );
  // npm skips a file: tarball whose version didn't change.
  fs.rmSync(path.join(projectDir, "node_modules", "meteor-rpc"), { recursive: true, force: true });
  await runOrThrow(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--no-package-lock",
      "--prefer-offline",
      "--loglevel=error",
    ],
    projectDir,
  );
}

/** Writes one Markdown file's app and type-checks it. Returns its snippets with their errors. */
async function checkDoc(markdownFile, prelude) {
  const name = displayName(markdownFile)
    .replace(/\.md$/, "")
    .replace(/^[./]+/, "")
    .replace(/[^\w-]+/g, "-");
  const appDir = path.join(projectDir, "docs", name);
  resetDir(appDir);
  fs.cpSync(fixtureRoot, appDir, { recursive: true });
  write(
    path.join(appDir, "tsconfig.json"),
    `${JSON.stringify({ compilerOptions: COMPILER_OPTIONS, include: ["**/*"] }, null, 2)}\n`,
  );

  const taken = new Set();
  const snippets = extractSnippets(markdownFile).map((snippet, index) =>
    plan(snippet, taken, index + 1, prelude),
  );
  for (const snippet of snippets) {
    if (snippet.status === "skip") continue;
    write(path.join(appDir, snippet.file), `${[...snippet.header, snippet.code].join("\n")}\n`);
    snippet.errors = [];
  }

  const tsc = path.join(projectDir, "node_modules", "typescript", "bin", "tsc");
  const result = await run(
    process.execPath,
    [tsc, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
    appDir,
  );
  const other = [];
  const lines = result.output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = ERROR_LINE.exec(lines[i]);
    let detail = match ? `${match.groups.code}: ${match.groups.message}` : lines[i];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) detail += `\n${lines[++i]}`;
    if (!match) {
      if (lines[i].trim()) other.push(detail);
      continue;
    }
    const file = match.groups.file.replaceAll("\\", "/");
    const snippet = snippets.find((s) => s.file === file && s.status !== "skip");
    if (!snippet) {
      other.push(`${file}:${match.groups.line}:${match.groups.col} ${detail}`);
      continue;
    }
    const codeLine = Number(match.groups.line) - 1 - snippet.header.length;
    const at = codeLine < 0 ? snippet.line - 1 : snippet.line + codeLine;
    snippet.errors.push(`${snippet.source}:${at}:${match.groups.col} ${detail}`);
  }
  if (result.code !== 0 && other.length === 0 && snippets.every((s) => !s.errors?.length)) {
    other.push(result.output.trim());
  }
  return { source: displayName(markdownFile), appDir, snippets, other };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function defaultDocs() {
  const docs = fs
    .readdirSync(path.join(repoRoot, "docs"))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => path.join(repoRoot, "docs", file));
  return [path.join(repoRoot, "README.md"), ...docs];
}

function describe(snippet) {
  if (snippet.status === "skip") return `skipped (${snippet.reason})`;
  if (snippet.kind === "file") return snippet.file;
  const firstLine = snippet.code.trim().split("\n", 1)[0];
  const preview = firstLine.length > 50 ? `${firstLine.slice(0, 49)}…` : firstLine;
  return `fragment "${preview}"${snippet.imports.length ? ` + prelude: ${snippet.imports.join(", ")}` : ""}`;
}

async function main() {
  const args = process.argv.slice(2);
  const skipBuild = args.includes("--skip-build");
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--skip-build");
  if (unknown.length > 0) {
    console.error(`Unknown option ${unknown[0]}. See the header of scripts/docs-snippets.mjs.`);
    process.exit(2);
  }
  const files = args.filter((arg) => !arg.startsWith("--")).map((file) => path.resolve(file));
  const docs = files.length > 0 ? files : defaultDocs();

  const started = Date.now();
  fs.mkdirSync(workDir, { recursive: true });
  console.log(`meteor-rpc docs snippets: ${docs.length} files, work dir ${workDir}`);
  const tarball = await packLibrary(skipBuild);
  await installProject(tarball);
  console.log(`installed ${path.basename(tarball)} with TypeScript ${DEPENDENCIES.typescript}\n`);

  const prelude = preludeExports();
  const results = await pool(docs, 4, (doc) => checkDoc(doc, prelude));

  let checked = 0;
  let skipped = 0;
  let failed = 0;
  let fixtureFailures = 0;
  for (const { source, appDir, snippets, other } of results) {
    console.log(`${source} (${path.relative(workDir, appDir)})`);
    for (const snippet of snippets) {
      const status =
        snippet.status === "skip" ? "skip" : snippet.errors.length > 0 ? "FAIL" : "ok  ";
      if (status === "skip") skipped++;
      else checked++;
      if (status === "FAIL") failed++;
      console.log(`  ${status} ${source}:${snippet.line} ${describe(snippet)}`);
      for (const error of snippet.errors ?? [])
        console.log(`         ${error.replaceAll("\n", "\n         ")}`);
    }
    if (other.length > 0) {
      fixtureFailures++;
      console.log("  FAIL errors outside the snippets (fixtures or tsconfig):");
      for (const error of other) console.log(`         ${error.replaceAll("\n", "\n         ")}`);
    }
  }
  console.log(
    `\n${checked - failed}/${checked} snippets compile, ${skipped} skipped, in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  if (failed + fixtureFailures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
