#!/usr/bin/env node
// Runs meteor-rpc against a real Meteor app, the way users consume it:
//   1. builds the library and packs it (`npm pack`) into ./meteor-rpc.tgz,
//   2. installs that tarball into examples/basic (package.json points at ../../meteor-rpc.tgz),
//   3. runs the app's Mocha tests headless (`meteor test --once`, server side, real DDP),
//      and with --client also its client tests (React hooks) in headless Chromium,
//   4. type-checks the example app against the packed .d.ts files.
//
// Usage:
//   npm run test:meteor                                # the app's Meteor release (.meteor/release)
//   npm run test:meteor -- --client                    # also run the client tests in headless Chromium
//   npm run test:meteor -- --release 3.6-beta.3        # also run on other releases (repeatable; release names, e.g. 3.6-beta.3)
//   npm run test:meteor -- --setup-only                # build, pack and install; then `cd examples/basic && meteor`
//   Other flags: --skip-build (reuse meteor-rpc.tgz), --no-typecheck, --port <n> (default 3100)
//
// --client drives the browser with meteortesting:mocha's Playwright driver. It downloads Playwright's
// headless Chromium once (into Playwright's cache); on CI Linux it also installs the system libraries.
//
// Needs Meteor installed (https://docs.meteor.com/about/install.html). Exits non-zero on any failure.

import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "examples", "basic");
const tarball = join(root, "meteor-rpc.tgz"); // must match "meteor-rpc" in examples/basic/package.json
const TEST_TIMEOUT_MS = 15 * 60 * 1000;

function parseArgs(argv) {
  const options = {
    releases: [],
    client: false,
    skipBuild: false,
    setupOnly: false,
    typecheck: true,
    port: 3100,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=", 2);
    const value = () => inline ?? argv[++i];
    if (flag === "--release") options.releases.push(value());
    else if (flag === "--client") options.client = true;
    else if (flag === "--skip-build") options.skipBuild = true;
    else if (flag === "--setup-only") options.setupOnly = true;
    else if (flag === "--no-typecheck") options.typecheck = false;
    else if (flag === "--port") options.port = Number(value());
    else {
      console.error(`Unknown option ${argv[i]}. See the header of scripts/meteor-test.mjs.`);
      process.exit(2);
    }
  }
  return options;
}

function log(message) {
  console.log(`\n\x1b[1m[meteor-test] ${message}\x1b[0m`);
}

/** Runs a command, streaming its output. Resolves with the exit code and the captured output (and stdout alone). */
function run(command, args, { cwd = root, env = {}, timeout, quiet = false } = {}) {
  console.log(
    `$ ${command} ${args.join(" ")}${cwd === root ? "" : `   (in ${relative(root, cwd) || "."})`}`,
  );
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let stdout = "";
    const forward = (stream, target) =>
      stream.on("data", (chunk) => {
        output += chunk;
        if (stream === child.stdout) stdout += chunk;
        if (!(quiet && stream === child.stdout)) target.write(chunk);
      });
    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);
    const timer =
      timeout &&
      setTimeout(() => {
        console.error(`\n[meteor-test] ${command} timed out after ${timeout / 1000}s, killing it`);
        child.kill("SIGTERM");
      }, timeout);
    child.on("error", (error) => {
      output += String(error);
      resolve({ code: 1, output, stdout });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), output, stdout });
    });
  });
}

async function mustRun(command, args, options) {
  const { code, stdout } = await run(command, args, options);
  if (code !== 0) {
    console.error(`\n[meteor-test] FAILED: ${command} ${args.join(" ")} (exit ${code})`);
    process.exit(code || 1);
  }
  return stdout;
}

function checkMeteor() {
  const result = spawnSync("meteor", ["--version"], { cwd: app, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    console.error(
      "[meteor-test] `meteor` was not found. Install it: https://docs.meteor.com/about/install.html",
    );
    process.exit(1);
  }
  return result.stdout.trim();
}

/** Builds dist/ and packs it exactly like `npm publish` would. Returns the tarball path. */
async function buildAndPack() {
  log("Building and packing meteor-rpc");
  await mustRun("npm", ["run", "build"]);
  const packDir = mkdtempSync(join(tmpdir(), "meteor-rpc-pack-"));
  const stdout = await mustRun(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
    {
      quiet: true,
    },
  );
  const [{ filename }] = JSON.parse(stdout);
  return join(packDir, filename);
}

/** Downloads the headless Chromium that meteortesting:mocha's Playwright driver launches. */
async function installBrowser() {
  log("Installing headless Chromium for the client tests");
  const args = ["install", "chromium", "--only-shell"];
  if (process.env.CI && process.platform === "linux") args.push("--with-deps");
  await mustRun(join(app, "node_modules", ".bin", "playwright"), args, { cwd: app });
}

async function install(packed) {
  copyFileSync(packed, tarball);
  rmSync(dirname(packed), { recursive: true, force: true });
  log(`Installing ${relative(root, tarball)} into ${relative(root, app)}`);
  // Force a reinstall: npm skips file: tarballs whose version didn't change.
  rmSync(join(app, "node_modules", "meteor-rpc"), { recursive: true, force: true });
  await mustRun("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], { cwd: app });
}

/** Runs the Mocha suite with one Meteor release. Returns true when it passed. */
async function runTests(release, { port, client }) {
  const appRelease = readFileSync(join(app, ".meteor", "release"), "utf8")
    .trim()
    .replace("METEOR@", "");
  let cwd = app;
  let copy;
  if (release && release !== appRelease) {
    // Another release may rewrite .meteor/versions; run it in a throwaway copy of the app.
    copy = mkdtempSync(join(tmpdir(), `meteor-rpc-example-${release}-`));
    cpSync(app, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !source.startsWith(join(app, ".meteor", "local")),
    });
    cwd = copy;
  }
  // `meteor test` adds the driver packages (meteortesting:*) to .meteor/versions; put it back.
  const versionsFile = join(cwd, ".meteor", "versions");
  const versions = readFileSync(versionsFile, "utf8");
  log(
    `Running the ${client ? "server and client" : "server"} tests with Meteor ${release ?? appRelease}`,
  );
  const args = [
    "test",
    "--once",
    "--driver-package",
    "meteortesting:mocha",
    "--port",
    String(port),
  ];
  if (release) args.push("--release", release);
  const { code, output } = await run("meteor", args, {
    cwd,
    env: {
      ...(client ? { TEST_CLIENT: "1", TEST_BROWSER_DRIVER: "playwright" } : { TEST_CLIENT: "0" }),
      // The Playwright driver imports playwright from $PWD/node_modules, and spawn doesn't set PWD.
      PWD: cwd,
    },
    timeout: TEST_TIMEOUT_MS,
  });
  if (!copy) writeFileSync(versionsFile, versions);
  // The classic bundler only warns when it can't resolve an import (e.g. "meteor-rpc/react").
  const unresolved = /Unable to resolve some modules/.test(output);
  if (unresolved) console.error("[meteor-test] Meteor could not resolve some modules (see above).");
  if (copy && code === 0 && !unresolved) rmSync(copy, { recursive: true, force: true });
  else if (copy) console.error(`[meteor-test] Kept the app copy for inspection: ${copy}`);
  return code === 0 && !unresolved;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = checkMeteor();
  console.log(
    `[meteor-test] ${version} (app release: ${readFileSync(join(app, ".meteor", "release"), "utf8").trim()})`,
  );

  if (!options.skipBuild || !existsSync(tarball)) {
    await install(await buildAndPack());
  } else if (!existsSync(join(app, "node_modules", "meteor-rpc"))) {
    await mustRun("npm", ["install", "--no-package-lock", "--no-audit", "--no-fund"], { cwd: app });
  }

  if (options.client) await installBrowser();

  if (options.setupOnly) {
    log(`Ready. Start the example with: cd ${relative(process.cwd(), app) || "."} && meteor`);
    return;
  }

  const results = [];
  for (const release of [undefined, ...options.releases]) {
    results.push({
      release: `${release ?? "app release"}${options.client ? " (server + client)" : ""}`,
      passed: await runTests(release, options),
    });
  }

  if (options.typecheck) {
    log("Type-checking the example app against the packed .d.ts files");
    const { code } = await run(join(app, "node_modules", ".bin", "tsc"), ["--noEmit", "-p", "."], {
      cwd: app,
    });
    results.push({ release: "tsc --noEmit (examples/basic)", passed: code === 0 });
  }

  log("Summary");
  for (const { release, passed } of results)
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${release}`);
  if (results.some((result) => !result.passed)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
