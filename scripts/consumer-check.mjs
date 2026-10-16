#!/usr/bin/env node
// Consumer type-check matrix (`npm run test:consumer`).
//
// Builds and packs meteor-rpc, installs the tarball into throwaway consumer projects
// (outside the repo) and runs `tsc --noEmit` on a fixture that uses the whole public API,
// for a covering set of: Meteor type provider x TypeScript x validator x @types/react x tsconfig.
//
//   node scripts/consumer-check.mjs                 run every row
//   node scripts/consumer-check.mjs --only native   run rows whose id contains "native"
//   node scripts/consumer-check.mjs --list          print the matrix
//   node scripts/consumer-check.mjs --skip-build    reuse dist/ (still packs)
//
// Env: CONSUMER_CHECK_DIR (work dir, default: <os tmp>/meteor-rpc-consumer-check),
//      CONSUMER_CHECK_CONCURRENCY (default 4).
//
// A row fails on any error in the fixture (src/), in meteor-rpc's own declarations
// (node_modules/meteor-rpc) or in the tsconfig. Errors inside other packages' declarations
// (@types/meteor, mongodb, validators, ...) are reported as warnings: they aren't ours.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(repoRoot, "scripts", "consumer");
const workDir = path.resolve(
  process.env.CONSUMER_CHECK_DIR ?? path.join(os.tmpdir(), "meteor-rpc-consumer-check"),
);
const concurrency = Math.max(1, Number(process.env.CONSUMER_CHECK_CONCURRENCY ?? 4));
if (workDir === path.parse(workDir).root || workDir === os.homedir() || workDir === repoRoot) {
  throw new Error(`CONSUMER_CHECK_DIR must be a dedicated directory, got ${workDir}`);
}

// ---------------------------------------------------------------------------
// Pinned inputs. Meteor declarations are fetched from raw.githubusercontent.com at exact commits.
// ---------------------------------------------------------------------------

const METEOR = {
  // Meteor 3.6 native declarations (`meteor types`): tag release/METEOR@3.6-rc.0.
  native: { ref: "cc8cf7d21d24da5f4a4fd456527225bc5ce0e721", label: "3.6-rc.0 native" },
  // Meteor 3.5.x core declarations as served by zodern:types: tag release/METEOR@3.5.3.
  zodern: { ref: "af0af5666565b769fcbfd4f7f5c52c24b013aa2c", label: "3.5.3 via zodern:types" },
};
const SKEL_TSCONFIG = `https://raw.githubusercontent.com/meteor/meteor/${METEOR.native.ref}/tools/static-assets/skel-typescript/tsconfig.json`;
/** Meteor packages the fixture imports; their `meteor/*` imports are followed automatically. */
const METEOR_SEEDS = ["meteor", "mongo", "ddp"];

const VERSIONS = {
  typescript: { 5.9: "5.9.3", "7.0": "7.0.2" },
  validator: {
    zod4: { zod: "4.6.7" },
    zod3: { zod: "3.24.0" }, // first zod 3 release implementing Standard Schema
    valibot: { valibot: "1.0.0" },
    arktype: { arktype: "2.0.0" },
  },
  react: {
    18: { react: "18.3.1", "@types/react": "18.3.31", "@tanstack/react-query": "5.0.0" },
    19: { react: "19.2.0", "@types/react": "19.3.0", "@tanstack/react-query": "5.104.3" },
  },
  typesMeteor: { "@types/meteor": "2.9.11" },
  mongodb: { mongodb: "6.16.0" }, // npm-mongo's Npm.depends in both pinned Meteor releases
  node: { "@types/node": "22.20.5" }, // every Meteor app has it; mongodb's types need it
  skel: { "@types/mocha": "8.2.3" }, // skel-typescript lists "mocha" in `types`
};

// Covering set: every provider, TypeScript version, validator, @types/react major and strict
// tsconfig flavour appears with skipLibCheck: false, and every provider runs on both TypeScript
// versions. "node16" is an ESM consumer ("type": "module", verbatimModuleSyntax); "node16-cjs" is
// a CommonJS consumer (verbatimModuleSyntax can't be used there). @types/meteor only resolves
// `meteor/*` subpaths in CommonJS mode under node16, so it gets the CJS flavour. "node10" is the
// `"moduleResolution": "node"` of older Meteor templates, e.g. 3.3 (ignores `exports` and uses
// typesVersions; removed in TypeScript 7). The skel rows use Meteor 3.6's skel-typescript tsconfig verbatim
// (skipLibCheck: true, its own `paths`).
const ROWS = [
  { provider: "native", ts: "5.9", validator: "zod4", react: 19, tsconfig: "bundler" },
  { provider: "native", ts: "7.0", validator: "valibot", react: 18, tsconfig: "node16" },
  { provider: "zodern", ts: "5.9", validator: "zod3", react: 18, tsconfig: "node16" },
  { provider: "zodern", ts: "7.0", validator: "arktype", react: 19, tsconfig: "bundler" },
  { provider: "types-meteor", ts: "5.9", validator: "arktype", react: 19, tsconfig: "bundler" },
  { provider: "types-meteor", ts: "7.0", validator: "zod4", react: 18, tsconfig: "node16-cjs" },
  { provider: "none", ts: "5.9", validator: "valibot", react: 19, tsconfig: "node16" },
  { provider: "none", ts: "7.0", validator: "zod3", react: 18, tsconfig: "bundler" },
  { provider: "none", ts: "7.0", validator: "zod4", react: null, tsconfig: "node16" },
  { provider: "zodern", ts: "5.9", validator: "zod4", react: 18, tsconfig: "node10" },
  { provider: "types-meteor", ts: "7.0", validator: "zod4", react: 19, tsconfig: "skel" },
  { provider: "native", ts: "5.9", validator: "zod4", react: 19, tsconfig: "skel" },
].map((row) => ({
  ...row,
  id: [
    row.provider,
    `ts${row.ts}`,
    row.validator,
    row.react ? `react${row.react}` : "no-react",
    row.tsconfig,
  ].join("-"),
}));

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
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, output: stdout + stderr }));
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

async function fetchCached(url) {
  const cacheFile = path.join(
    workDir,
    "cache",
    url.replace(/^https?:\/\//, "").replace(/[^\w./@-]/g, "_"),
  );
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, "utf8");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      write(cacheFile, text);
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw new Error(`could not fetch ${url}: ${lastError}`);
}

// ---------------------------------------------------------------------------
// Meteor declarations
// ---------------------------------------------------------------------------

/**
 * Collects the declaration file of each Meteor package the fixture needs, following
 * `meteor/*` imports. `native` picks what `api.types()` registers (what `meteor types` uses);
 * `zodern` picks the legacy `.d.ts` asset (what zodern:types uses).
 */
async function collectMeteorDeclarations(provider) {
  const { ref } = METEOR[provider];
  const base = `https://raw.githubusercontent.com/meteor/meteor/${ref}/packages`;
  const queue = [...METEOR_SEEDS];
  const seen = new Set();
  const result = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const packageJs = await fetchCached(`${base}/${name}/package.js`);
    const typesCall = packageJs.match(/api\.types\(\s*['"]([^'"]+\.d\.ts)['"]/);
    const assetDts = packageJs.match(/api\.addAssets\(\s*['"]([^'"]+\.d\.ts)['"]/);
    const file = provider === "native" ? (typesCall ?? assetDts)?.[1] : assetDts?.[1];
    if (!file) throw new Error(`no declarations for meteor/${name} (${provider} @ ${ref})`);
    const body = await fetchCached(`${base}/${name}/${file}`);
    for (const match of body.matchAll(/(?:from\s+|import\(\s*)['"]meteor\/([^'"/]+)/g)) {
      queue.push(match[1]);
    }
    result.push({ name, file, body });
  }
  return result;
}

const isExternalModule = (body) => /^\s*(import|export)\b/m.test(body);
const hasDeclareModule = (body) => /^\s*declare\s+module\s+['"]/m.test(body);

/** Mirrors tools/isobuild/types-generator.js (single-file mode) of Meteor 3.6. */
function writeNativeTypes(projectDir, declarations) {
  const typesDir = path.join(projectDir, ".meteor", "types");
  write(path.join(typesDir, ".gitignore"), "*\n");
  write(path.join(typesDir, "package.json"), '{\n  "type": "commonjs"\n}\n');
  const references = [];
  for (const { name, body } of declarations) {
    const packageDir = path.join(typesDir, "packages", name);
    if (hasDeclareModule(body) && !isExternalModule(body)) {
      write(path.join(packageDir, "index.d.ts"), `${body.trim()}\n`);
    } else {
      write(path.join(packageDir, "declarations", "index.d.ts"), body);
      write(
        path.join(packageDir, "index.d.ts"),
        `declare module "meteor/${name}" {\n  import exports = require("meteor-package-types/${name}/declarations/index");\n  export = exports;\n}\n`,
      );
    }
    references.push(`/// <reference path="./packages/${name}/index.d.ts" />`);
  }
  fs.mkdirSync(path.join(typesDir, "node_modules"), { recursive: true });
  fs.symlinkSync("../packages", path.join(typesDir, "node_modules", "meteor-package-types"), "dir");
  write(
    path.join(typesDir, "packages.d.ts"),
    `// This file is auto-generated by Meteor. Do not edit manually.\n\n${references.join("\n")}\n`,
  );
}

/** Mirrors zodern:types' writer.js: `.meteor/local/types/packages.d.ts` + node_modules/package-types. */
function writeZodernTypes(projectDir, declarations) {
  const typesDir = path.join(projectDir, ".meteor", "local", "types");
  const npmPackage = path.join(typesDir, "node_modules", "package-types");
  write(path.join(npmPackage, "package.json"), JSON.stringify({ name: "package-types" }, null, 2));
  let content = "";
  for (const { name, file, body } of declarations) {
    write(path.join(npmPackage, name, "package", "os", file), body);
    const typesPath = `os/${file}`.replace(".ts", "");
    content += `\ndeclare module 'meteor/${name}' {\n  import exports = require('package-types/${name}/package/${typesPath}');\n  export = exports;\n}\n`;
  }
  write(path.join(typesDir, "packages.d.ts"), content);
}

// ---------------------------------------------------------------------------
// Consumer projects
// ---------------------------------------------------------------------------

const STRICT_OPTIONS = {
  target: "es2022",
  lib: ["es2022", "dom"],
  jsx: "react-jsx",
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noPropertyAccessFromIndexSignature: true,
  noImplicitOverride: true,
  noImplicitReturns: true,
  noFallthroughCasesInSwitch: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  forceConsistentCasingInFileNames: true,
  esModuleInterop: true, // every Meteor template sets it (TypeScript 7 always behaves this way)
  skipLibCheck: false,
  noEmit: true,
  types: ["node"],
};

function strictTsconfig(row) {
  const compilerOptions = {
    ...STRICT_OPTIONS,
    ...{
      bundler: { module: "preserve", moduleResolution: "bundler" },
      node10: { module: "esnext", moduleResolution: "node10" },
      node16: { module: "node16", moduleResolution: "node16" },
      "node16-cjs": { module: "node16", moduleResolution: "node16" },
    }[row.tsconfig],
  };
  if (row.tsconfig === "node16-cjs") delete compilerOptions.verbatimModuleSyntax;
  const config = { compilerOptions, include: ["src"] };
  if (row.provider === "native") {
    // docs/cli/using-core-types.md, without "baseUrl" (removed in TypeScript 7).
    config.files = ["./.meteor/types/packages.d.ts"];
    compilerOptions.paths = { "meteor/*": ["./.meteor/types/packages/*"] };
  } else if (row.provider === "zodern") {
    compilerOptions.paths = { "meteor/*": ["./.meteor/local/types/packages.d.ts"] };
    compilerOptions.preserveSymlinks = true;
  } else if (row.provider === "types-meteor") {
    compilerOptions.paths = { "meteor/*": ["./node_modules/@types/meteor/*"] };
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function dependenciesFor(row, tarball) {
  return {
    "meteor-rpc": `file:${tarball}`,
    typescript: VERSIONS.typescript[row.ts],
    ...VERSIONS.node,
    ...VERSIONS.validator[row.validator],
    ...(row.react ? VERSIONS.react[row.react] : {}),
    ...(row.provider === "types-meteor" ? VERSIONS.typesMeteor : {}),
    ...(row.provider === "native" || row.provider === "zodern" ? VERSIONS.mongodb : {}),
    ...(row.tsconfig === "skel" ? VERSIONS.skel : {}),
  };
}

function copyFixtures(row, projectDir) {
  const src = path.join(projectDir, "src");
  const copy = (from, to) => fs.cpSync(path.join(fixtureRoot, from), path.join(src, to));
  for (const file of fs.readdirSync(path.join(fixtureRoot, "fixture")))
    copy(`fixture/${file}`, file);
  copy(`schemas/${row.validator}.ts`, "schemas.ts");
  copy(row.provider === "none" ? "db/none.ts" : "db/meteor.ts", "db.ts");
  if (row.react)
    for (const file of fs.readdirSync(path.join(fixtureRoot, "react"))) copy(`react/${file}`, file);
  if (row.provider !== "none") copy("interop/interop.ts", "interop.ts");
}

const ERROR_LINE =
  /^(?<file>[^\s(][^(]*)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<message>.*)$/;

function classify(output) {
  const errors = { fixture: [], lib: [], config: [], thirdParty: [] };
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = ERROR_LINE.exec(line);
    // Keep the indented elaboration lines that follow an error.
    let detail = line;
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) detail += `\n${lines[++i]}`;
    if (!match) {
      if (/error TS\d+/.test(line)) errors.config.push(detail);
      continue;
    }
    const file = match.groups.file.replaceAll("\\", "/");
    if (file.startsWith("src/")) errors.fixture.push(detail);
    else if (file.includes("node_modules/meteor-rpc/")) errors.lib.push(detail);
    else if (/^tsconfig.*\.json$/.test(file)) errors.config.push(detail);
    else errors.thirdParty.push(detail);
  }
  return errors;
}

async function checkRow(row, tarball, declarations, skelTsconfig) {
  const started = Date.now();
  const projectDir = path.join(workDir, "rows", row.id);
  resetDir(projectDir);
  const packageJson = {
    name: `consumer-${row.id}`,
    private: true,
    ...(row.tsconfig === "node16" ? { type: "module" } : {}),
    devDependencies: dependenciesFor(row, tarball),
  };
  write(path.join(projectDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
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
  copyFixtures(row, projectDir);
  if (row.provider === "native") writeNativeTypes(projectDir, declarations.native);
  if (row.provider === "zodern") writeZodernTypes(projectDir, declarations.zodern);
  write(
    path.join(projectDir, "tsconfig.json"),
    row.tsconfig === "skel" ? skelTsconfig : strictTsconfig(row),
  );

  const tsc = path.join(projectDir, "node_modules", "typescript", "bin", "tsc");
  const version = (await runOrThrow(process.execPath, [tsc, "--version"], projectDir)).trim();
  const result = await run(
    process.execPath,
    [tsc, "-p", "tsconfig.json", "--noEmit", "--pretty", "false"],
    projectDir,
  );
  const errors = classify(result.output);
  const failed =
    errors.fixture.length + errors.lib.length + errors.config.length > 0 ||
    (result.code !== 0 && errors.thirdParty.length === 0);
  return {
    row,
    version,
    errors,
    failed,
    output: result.output,
    seconds: (Date.now() - started) / 1000,
    projectDir,
  };
}

// ---------------------------------------------------------------------------
// Library tarball
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
  const tarball = path.join(packDir, filename);

  // Published declarations must never depend on a Meteor type provider.
  const offenders = [];
  for (const { path: file } of files) {
    if (!/\.d\.[cm]?ts$/.test(file)) continue;
    const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
    if (BARE_METEOR_IMPORT.test(content)) offenders.push(file);
  }
  if (offenders.length > 0) {
    throw new Error(`published declarations import "meteor/*":\n  ${offenders.join("\n  ")}`);
  }
  for (const entry of ["server/package.json", "client/package.json", "react/package.json"]) {
    if (!files.some((file) => file.path === entry)) throw new Error(`tarball is missing ${entry}`);
  }
  return { tarball, fileCount: files.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

function printMatrix(rows) {
  console.log("provider      ts   validator  react  tsconfig    id");
  for (const row of rows) {
    console.log(
      `${row.provider.padEnd(13)} ${row.ts.padEnd(4)} ${row.validator.padEnd(10)} ${String(row.react ?? "-").padEnd(6)} ${row.tsconfig.padEnd(11)} ${row.id}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
  const rows = only ? ROWS.filter((row) => row.id.includes(only)) : ROWS;
  if (args.includes("--list")) {
    printMatrix(rows);
    return;
  }
  if (rows.length === 0) throw new Error(`no row matches --only ${only}`);

  const started = Date.now();
  fs.mkdirSync(workDir, { recursive: true });
  console.log(`meteor-rpc consumer check: ${rows.length} rows, work dir ${workDir}`);

  const { tarball, fileCount } = await packLibrary(args.includes("--skip-build"));
  console.log(
    `packed ${path.basename(tarball)} (${fileCount} files, no "meteor/*" imports in .d.ts)`,
  );

  const needs = (provider) => rows.some((row) => row.provider === provider);
  const [native, zodern, skelTsconfig] = await Promise.all([
    needs("native") ? collectMeteorDeclarations("native") : [],
    needs("zodern") ? collectMeteorDeclarations("zodern") : [],
    rows.some((row) => row.tsconfig === "skel") ? fetchCached(SKEL_TSCONFIG) : "",
  ]);
  const declarations = { native, zodern };
  for (const provider of ["native", "zodern"]) {
    if (declarations[provider].length > 0) {
      const list = declarations[provider].map((d) => `${d.name}:${d.file}`).join(", ");
      console.log(`Meteor ${METEOR[provider].label} declarations: ${list}`);
    }
  }

  const results = await pool(rows, concurrency, async (row) => {
    try {
      const result = await checkRow(row, tarball, declarations, skelTsconfig);
      const { fixture, lib, config, thirdParty } = result.errors;
      console.log(
        `${result.failed ? "FAIL" : "ok  "} ${row.id} (${result.version}, ${result.seconds.toFixed(1)}s) ` +
          `fixture=${fixture.length} meteor-rpc=${lib.length} config=${config.length} third-party=${thirdParty.length}`,
      );
      return result;
    } catch (error) {
      console.log(`FAIL ${row.id}: ${error.message}`);
      return { row, failed: true, crashed: error };
    }
  });

  for (const result of results) {
    if (result.crashed) continue;
    const { fixture, lib, config, thirdParty } = result.errors;
    if (result.failed) {
      console.log(`\n--- ${result.row.id} (${result.projectDir})`);
      for (const line of [...config, ...lib, ...fixture]) console.log(line);
      if (fixture.length + lib.length + config.length === 0) console.log(result.output.trim());
    }
    if (thirdParty.length > 0) {
      console.log(
        `\n--- ${result.row.id}: ${thirdParty.length} error(s) in third-party declarations (warning)`,
      );
      for (const line of thirdParty.slice(0, 10)) console.log(line);
      if (thirdParty.length > 10) console.log(`... ${thirdParty.length - 10} more`);
    }
  }

  const failed = results.filter((result) => result.failed);
  console.log(
    `\n${rows.length - failed.length}/${rows.length} rows passed in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
