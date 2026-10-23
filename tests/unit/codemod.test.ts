// The 1.x → 2.0 codemod (src/codemod). Fixtures in tests/fixtures/codemod hold 1.x code
// (input.*) and the expected result (output.*); small edge cases are inline strings.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { type CliIo, main, parseArgs } from "../../src/codemod/main";
import { createProject, type Project } from "../../src/codemod/project";
import { formatDiff } from "../../src/codemod/report";
import { findSourceFiles, migrateFiles } from "../../src/codemod/run";
import { ANCHORS, type Finding, transform } from "../../src/codemod/transform";

const fixtures = fileURLToPath(new URL("../fixtures/codemod/", import.meta.url));
const fixture = (name: string) => path.join(fixtures, name);
const read = (fileName: string) => fs.readFileSync(fileName, "utf8");

/** A project whose other files live in memory; Meteor absolute imports resolve from /app. */
function memoryProject(files: Record<string, string> = {}): Project {
  const contents = new Map(Object.entries(files));
  return createProject(ts, {
    fileExists: (fileName) => contents.has(fileName),
    readFile: (fileName) => contents.get(fileName),
    appRoot: () => "/app",
  });
}

const FILE = "/app/imports/ui/File.tsx";
const run = (source: string, files: Record<string, string> = {}, fileName = FILE) =>
  transform(fileName, source, ts, memoryProject(files));

/** The fixture file, migrated alone (other files are read from disk if it imports them). */
const migrateFixture = (name: string) => {
  const [file] = migrateFiles([fixture(name)], ts);
  if (!file) throw new Error(`missing fixture ${name}`);
  return file.result;
};

/** "<line> §<section> <message up to the first colon>" */
const summary = (findings: readonly Finding[]) =>
  findings.map(({ line, anchor, message }) => {
    const section = /#(\d+)-/.exec(anchor)?.[1] ?? anchor;
    return `${line} §${section} ${message.split(":")[0]}`;
  });

const CLIENT = `import { createClient } from "meteor-rpc";\nexport const api = createClient<Server>();\n`;

describe("--suspense-client (§8)", () => {
  const runSuspense = (source: string) =>
    transform(FILE, source, ts, memoryProject(), { suspenseClient: true });

  it("keeps useQuery, unwraps useQueryOptions and adds { suspense: true } to createClient()", () => {
    const result = runSuspense(
      `${CLIENT}api.a.useQuery(1);\napi.b.useQuery(1, { useQueryOptions: { retry: false } });\n`,
    );
    expect(result.output).toBe(
      'import { createClient } from "meteor-rpc";\nexport const api = createClient<Server>({ suspense: true });\napi.a.useQuery(1);\napi.b.useQuery(1, { retry: false });\n',
    );
    expect(summary(result.changes)).toEqual([
      "2 §8 createClient() → createClient({ suspense",
      "4 §8 api.b.useQuery()",
    ]);
    expect(result.manual).toEqual([]);
  });

  it("adds the option next to other client options, once", () => {
    const withOptions = runSuspense(
      'import { createClient } from "meteor-rpc/react";\nexport const api = createClient<Server>({ connection });\n',
    );
    expect(withOptions.output).toContain("createClient<Server>({ suspense: true, connection })");
    const already =
      'import { createClient } from "meteor-rpc";\nconst api = createClient<S>({ suspense: true });\n';
    expect(runSuspense(already).output).toBe(already);
    expect(runSuspense(already).changes).toEqual([]);
    const off = runSuspense(
      'import { createClient } from "meteor-rpc";\nconst api = createClient<S>({ suspense: false });\n',
    );
    expect(summary(off.manual)).toEqual(["2 §8 pass { suspense"]);
  });

  it("leaves the client without hooks alone", () => {
    const source =
      'import { createClient } from "meteor-rpc/client";\nconst api = createClient<S>();\n';
    expect(runSuspense(source).output).toBe(source);
  });

  it("is a CLI flag", () => {
    expect(parseArgs(["--suspense-client", "imports"])).toMatchObject({
      suspenseClient: true,
      paths: ["imports"],
    });
  });
});

describe("useQuery → useSuspenseQuery (§8)", () => {
  it("renames calls on the client and unwraps useQueryOptions", () => {
    const result = migrateFixture("use-query/input.tsx");
    expect(result.output).toBe(read(fixture("use-query/output.tsx")));
    expect(result.changes).toHaveLength(5);
    expect(result.changes.every((change) => change.anchor === ANCHORS.react)).toBe(true);
    expect(summary(result.manual)).toEqual([
      "23 §8 api.todos.list.useQuery() has options other than useQueryOptions",
      "25 §8 api.todos.list.useQuery() gets its options from an expression the codemod can't follow",
    ]);
  });

  it("leaves useQuery calls that aren't on a meteor-rpc client alone", () => {
    const source = `import { useQuery } from "@tanstack/react-query";
import { trpc } from "./trpc";
const api = makeApi();
useQuery({ queryKey: ["a"] });
trpc.todos.list.useQuery("x");
api.todos.list.useQuery("x");
`;
    expect(run(source)).toMatchObject({ output: source, changes: [], manual: [] });
  });

  it("ignores clients without hooks from meteor-rpc/client", () => {
    const source = `import { createClient } from "meteor-rpc/client";
const api = createClient<Server>();
api.todos.list.useQuery("x");
`;
    expect(run(source).output).toBe(source);
  });

  it("handles quoted keys, undefined options and casts around the client", () => {
    const source = `${CLIENT}const local = createClient<Server>() as Client;
api.a.useQuery(1, { "useQueryOptions": { retry: false } });
local.b.useQuery(undefined, undefined);
api.c?.d.useQuery();
`;
    expect(run(source).output).toBe(`${CLIENT}const local = createClient<Server>() as Client;
api.a.useSuspenseQuery(1, { retry: false });
local.b.useSuspenseQuery(undefined, undefined);
api.c?.d.useSuspenseQuery();
`);
  });

  it("reports references that aren't calls", () => {
    const result = run(`${CLIENT}const hook = api.todos.list.useQuery;\n`);
    expect(result.changes).toEqual([]);
    expect(summary(result.manual)).toEqual([
      "3 §8 api.todos.list.useQuery is referenced without being called",
    ]);
  });
});

describe("hooks and middlewares take one context object (§5)", () => {
  it("rewrites inline functions and reports the rest", () => {
    const result = migrateFixture("hooks/input.ts");
    expect(result.output).toBe(read(fixture("hooks/output.ts")));
    expect(result.changes.map(({ line, message }) => `${line} ${message}`)).toEqual([
      "11 onAfterResolve hook: (raw: unknown, parsed: string, result: number) → ({ raw, parsed, result }); kept the parameter types on the context object",
      "20 middleware: (raw, parsed) → ({ raw, parsed })",
      "21 middleware: (r) → ({ raw: r })",
      "30 onBeforeResolve hook: (_raw, { length }: string) → ({ raw: _raw, parsed: { length } }); dropped the parameter types (meteor-rpc infers the context type)",
      "31 onAfterResolve hook: (raw, parsed, result) → ({ raw, parsed, result })",
      "32 onErrorResolve hook: (err, raw, parsed) → ({ error: err, raw, parsed })",
      "38 onBeforeResolve hook: (raw: unknown) → ({ raw }); dropped the parameter types (meteor-rpc infers the context type)",
      "41 onErrorResolve hook: (error) → ({ error })",
    ]);
    expect(summary(result.manual)).toEqual([
      "24 §5 update the signature of rateLog",
      "25 §5 middleware with a rest parameter",
      "32 §7 errors are re-thrown after onErrorResolve hooks run (1.x swallowed them and resolved with undefined)",
      "39 §5 onAfterResolve hook declares more parameters than 1.x passed (raw, parsed, result)",
      "40 §7 errors are re-thrown after onErrorResolve hooks run (1.x swallowed them and resolved with undefined)",
      "42 §5 onErrorResolve hook with a default value",
    ]);
  });

  it("adds parentheses, keeps `this` and collapses multi-line parameter lists", () => {
    const source = `import { createModule } from "meteor-rpc";
createModule().addMiddlewares([
  raw => log(raw),
  function (this: Invocation, raw) { log(this, raw); },
  (
    raw,
    parsed, // trailing comment
  ) => log(raw, parsed),
]);
`;
    expect(run(source).output).toBe(`import { createModule } from "meteor-rpc";
createModule().addMiddlewares([
  ({ raw }) => log(raw),
  function (this: Invocation, { raw }) { log(this, raw); },
  ({ raw, parsed }) => log(raw, parsed),
]);
`);
  });

  it("follows const configs, hooks objects and hook arrays in the same file", () => {
    const source = `import { createModule } from "meteor-rpc";
const before = [(raw, parsed) => log(raw, parsed)];
const hooks = { onBeforeResolve: before };
const config = { hooks };
createModule().addMethod("a", schema, fn, config).addPublication("b", schema, fn, config);
`;
    const result = run(source);
    expect(result.output).toBe(source.replace("(raw, parsed) =>", "({ raw, parsed }) =>"));
    expect(result.changes).toHaveLength(1);
  });

  it("reports configs it can't see", () => {
    const source = `import { createModule } from "meteor-rpc";
import { sharedConfig } from "./config";
createModule().addMethod("a", schema, fn, sharedConfig).addMiddlewares(middlewares);
`;
    expect(summary(run(source).manual)).toEqual([
      "3 §5 config sharedConfig isn't defined in this file",
      "3 §5 middlewares in middlewares",
    ]);
  });

  it("only touches files that import createModule from meteor-rpc", () => {
    const source = `import { createServer } from "other";
createServer().addMiddlewares([(req, res) => res.end()]);
`;
    expect(run(source).output).toBe(source);
  });
});

describe("manual items", () => {
  it("reports removed exports, method helpers, build() on submodules, array shared publications and __isError__", () => {
    const result = migrateFixture("manual/server.ts");
    expect(result.output).toBe(read(fixture("manual/server.ts")));
    expect(result.changes).toEqual([]);
    expect(summary(result.manual)).toEqual([
      "3 §11 createMethod was removed",
      "3 §11 createSafeCaller was removed",
      "3 §11 the ReturnMethod type was removed",
      "7 §11 expect() was removed",
      "8 §5 addBeforeResolveHook() was removed",
      "9 §11 setResolver() was removed",
      '13 §12 build() on a namespaced module (createModule("chat")) throws in 2.0',
      '16 §10 shared publication "room" returns an array of cursors',
      '22 §10 shared publication "lobby" returns an array of cursors',
      "31 §7 1.x error envelopes ({ __isError__ }) are gone",
    ]);
  });

  it("finds removed exports through namespaces, require and re-exports", () => {
    const source = `import * as rpc from "meteor-rpc";
const { createPublication } = require("meteor-rpc");
export { createRealtimeQuery as realtime } from "meteor-rpc";
rpc.createMutation("a", schema, fn);
type Callbacks = rpc.SubscriptionCallbacks;
`;
    expect(run(source).manual.map((item) => item.message.split(" was removed")[0])).toEqual([
      "createPublication",
      "createRealtimeQuery",
      "createMutation",
      "the SubscriptionCallbacks type",
    ]);
  });

  it("doesn't report build() on the root module", () => {
    const source = `import { createModule } from "meteor-rpc";
const root = createModule().addMethod("a", schema, fn);
export const server = root.build();
export const other = createModule(undefined).build();
`;
    expect(run(source).manual).toEqual([]);
  });

  it("reports __isError__ checks in any file", () => {
    const result = run(`if ("__isError__" in result) throw result;\n`);
    expect(summary(result.manual)).toEqual(["1 §7 1.x error envelopes ({ __isError__ }) are gone"]);
  });

  it("reports files it can't parse instead of editing them", () => {
    const source = `${CLIENT}api.a.useQuery(1, { useQueryOptions: {} ;\n`;
    const result = run(source);
    expect(result.output).toBe(source);
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.message).toMatch(/^could not parse this file/);
  });
});

describe("Atmosphere package", () => {
  it("rewrites meteor/grubba:rpc imports and migrates JSX in .jsx files", () => {
    const result = migrateFixture("atmosphere/input.jsx");
    expect(result.output).toBe(read(fixture("atmosphere/output.jsx")));
    expect(result.changes.map((change) => change.anchor)).toEqual([ANCHORS.install, ANCHORS.react]);
  });
});

describe("client tracking across files", () => {
  const ui = ["Absolute.tsx", "Barrel.tsx", "Namespace.tsx", "Relative.tsx"];

  it("follows Meteor absolute imports, relative imports, re-exports and namespace imports", () => {
    const files = ui.map((name) => fixture(`app/imports/ui/${name}`));
    // Only the UI files are given: the client file is found through their imports.
    const results = migrateFiles(files, ts);
    for (const [index, name] of ui.entries()) {
      expect(results[index]?.result.output).toBe(read(fixture(`app-output/imports/ui/${name}`)));
      expect(results[index]?.result.changes).toHaveLength(1);
    }
    // `notAClient.todos.list.useQuery()` stays.
    expect(results[0]?.result.output).toContain("notAClient.todos.list.useQuery(filter)");
  });

  it("resolves index files and .js specifiers in memory too", () => {
    const files = { "/app/imports/api/index.ts": CLIENT };
    const source = `import { api } from "/imports/api";
import * as client from "../api/index.js";
api.a.useQuery();
client.api.b.useQuery();
client.other.c.useQuery();
`;
    const result = run(source, files);
    expect(result.changes).toHaveLength(2);
    expect(result.output).toContain("client.other.c.useQuery()");
  });

  it("stops at import cycles", () => {
    const files = {
      "/app/a.ts": `export { api } from "./b";\n`,
      "/app/b.ts": `export { api } from "./a";\n`,
    };
    const source = `import { api } from "./a";\napi.x.useQuery();\n`;
    expect(run(source, files, "/app/main.ts").output).toBe(source);
  });
});

describe("idempotency and formatting", () => {
  it.each(["use-query/output.tsx", "hooks/output.ts", "atmosphere/output.jsx", "manual/server.ts"])(
    "changes nothing when run again on %s",
    (name) => {
      const result = migrateFixture(name);
      expect(result.output).toBe(read(fixture(name)));
      expect(result.changes).toEqual([]);
    },
  );

  it("keeps CRLF line endings, tabs and comments", () => {
    const source = `${CLIENT}// note\r\nfunction A() {\r\n\tconst q = api.a.useQuery(1, { useQueryOptions: o }); // keep\r\n}\r\n`;
    expect(run(source).output).toBe(
      `${CLIENT}// note\r\nfunction A() {\r\n\tconst q = api.a.useSuspenseQuery(1, o); // keep\r\n}\r\n`,
    );
  });

  it("skips 2.0-style hooks", () => {
    const source = `import { createModule } from "meteor-rpc";
createModule().addMiddlewares([
  ({ userId, type }) => check(userId, type),
  (ctx) => log(ctx.name),
  (c: MiddlewareContext) => log(c.raw),
]);
`;
    expect(run(source)).toMatchObject({ output: source, changes: [] });
  });

  it("prints a unified diff", () => {
    const source = "a\nb\nc\nd\ne\nf\ng\nh\n";
    const diff = formatDiff("x.ts", source, [
      { start: 2, end: 3, text: "B" },
      { start: 14, end: 15, text: "H1\nH2" },
    ]);
    expect(diff).toBe(`--- a/x.ts
+++ b/x.ts
@@ -1,4 +1,4 @@
 a
-b
+B
 c
 d
@@ -6,3 +6,4 @@
 f
 g
-h
+H1
+H2
`);
  });
});

describe("CLI", () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true });
  });

  /** A copy of the app fixture, so --write doesn't touch the repo. */
  const copyApp = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meteor-rpc-codemod-"));
    temporary.push(directory);
    fs.cpSync(fixture("app"), directory, { recursive: true });
    return directory;
  };

  const cli = (
    args: string[],
    cwd: string,
    loadTypeScript: () => typeof ts | undefined = () => ts,
  ) => {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      cwd,
      color: false,
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    };
    const code = main(args, io, loadTypeScript);
    return { code, stdout, stderr };
  };

  it("prints a diff and writes nothing without --write", () => {
    const app = copyApp();
    const before = read(path.join(app, "imports/ui/Relative.tsx"));
    const { code, stdout } = cli(["imports"], app);
    expect(code).toBe(0);
    expect(stdout).toContain("--- a/imports/ui/Relative.tsx");
    expect(stdout).toContain("+  const { data } = client.todos.count.useSuspenseQuery();");
    expect(stdout).toContain("Would change 4 files (4 changes); nothing needs a manual fix");
    expect(stdout).toContain("Re-run with --write");
    expect(read(path.join(app, "imports/ui/Relative.tsx"))).toBe(before);
  });

  it("writes with --write, and a second run finds nothing", () => {
    const app = copyApp();
    expect(cli(["--write", "imports"], app).stdout).toContain("Changed 4 files (4 changes)");
    for (const name of ["Absolute.tsx", "Barrel.tsx", "Namespace.tsx", "Relative.tsx"]) {
      expect(read(path.join(app, "imports/ui", name))).toBe(
        read(fixture(`app-output/imports/ui/${name}`)),
      );
    }
    const second = cli(["--write", "--check", "imports"], app);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("Nothing to migrate (scanned 6 files).");
  });

  it("prints JSON findings for agents, and --check fails when there are some", () => {
    const { code, stdout } = cli(["--json", "--check", "manual", "atmosphere"], fixtures);
    expect(code).toBe(1);
    const findings = JSON.parse(stdout) as Record<string, unknown>[];
    expect(findings[0]).toEqual({
      file: "atmosphere/input.jsx",
      line: 1,
      column: 30,
      kind: "change",
      message:
        '"meteor/grubba:rpc" → "meteor-rpc" (2.0 is npm only: run `meteor remove grubba:rpc`)',
      anchor: "MIGRATION.md#2-install",
    });
    expect(findings.filter((finding) => finding.kind === "manual")).toHaveLength(10);
  });

  it("skips node_modules, .meteor, dist, build and .git", () => {
    const app = copyApp();
    for (const directory of ["node_modules/x", ".meteor/local", "dist", "build", ".git"]) {
      fs.mkdirSync(path.join(app, directory), { recursive: true });
      fs.writeFileSync(path.join(app, directory, "skipped.ts"), "x.__isError__;\n");
    }
    fs.writeFileSync(path.join(app, "notes.md"), "");
    const found = findSourceFiles([app, path.join(app, "notes.md")]);
    expect(found.files.map((file) => path.relative(app, file))).toEqual([
      "imports/api/client.ts",
      "imports/api/index.ts",
      "imports/ui/Absolute.tsx",
      "imports/ui/Barrel.tsx",
      "imports/ui/Namespace.tsx",
      "imports/ui/Relative.tsx",
    ]);
    expect(found.ignored).toEqual([path.join(app, "notes.md")]);
  });

  it("explains how to get TypeScript when it can't load it", () => {
    const { code, stderr } = cli(["."], fixtures, () => undefined);
    expect(code).toBe(2);
    expect(stderr).toContain("npx -y -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate");
  });

  it("rejects unknown options and missing paths", () => {
    expect(cli(["--nope", "."], fixtures).code).toBe(2);
    expect(cli([], fixtures).code).toBe(2);
    expect(cli(["does-not-exist"], fixtures)).toMatchObject({ code: 2 });
    expect(cli(["--help"], fixtures).stdout).toMatch(/^Usage: meteor-rpc-migrate/);
  });
});

describe("MIGRATION.md", () => {
  it("has a section for every anchor the codemod links to", () => {
    const guide = read(fileURLToPath(new URL("../../MIGRATION.md", import.meta.url)));
    const slugs = [...guide.matchAll(/^#{1,6} (.+)$/gm)].map(([, heading = ""]) =>
      heading
        .toLowerCase()
        .replace(/[^\p{L}\p{N} _-]/gu, "")
        .replace(/ /g, "-"),
    );
    for (const anchor of Object.values(ANCHORS)) {
      expect(slugs).toContain(anchor.replace("MIGRATION.md#", ""));
    }
  });
});
