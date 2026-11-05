# AGENTS.md

Guide for coding agents (and new human contributors) working **on this repository**. To use
meteor-rpc in an app, read the [README](./README.md). To migrate an app from 1.x, use
`skills/migrate-to-v2`. Keep this file accurate: update it in the same change that makes it wrong.

## What this is

`meteor-rpc` is an npm package giving Meteor apps end-to-end type-safe methods and publications.

- **Server.** A builder (`createModule`) declares procedures with Standard Schema validators.
- **Client.** A typed proxy (`createClient<typeof server>()`) calls them, optionally with
  TanStack Query and publication hooks for React.

It runs inside Meteor apps only (it reads Meteor's packages from the `Package` global at
runtime), on Meteor 3.0+.

## Repo map

| Path | What it is |
| --- | --- |
| `src/meteor/` | **The Meteor boundary.** The only code that touches Meteor. `package.ts` reads each package from the `Package` global on first use, and every module narrows it to a small structural interface. `types.ts` holds the public Meteor-like types (`Subscription`, `ClientCollection`, …). |
| `src/shared/` | Code used by server and client: `types.ts` (definitions, contexts, hooks, `Client<T>`), `schema.ts` (Standard Schema validation), `standard-schema.ts` (vendored spec), `errors.ts`, `names.ts` (reserved names, collection names). |
| `src/server/` | `module.ts` (immutable builder state, `createModule`), `register.ts` (`build()` → `Meteor.methods` / `Meteor.publish`, the one call pipeline, publishing), `types.ts` (`ModuleBuilder` interface), `caller.ts` (`createCaller`: server-side calls into a module, resolved to its full name per call). |
| `src/client/` | `proxy.ts` (pure path → name resolution), `transport.ts` (calls, subscriptions, per-connection collection registry), `helpers.ts` (`subscribe`, `collection`, `collections`, `subscribeInstance`). |
| `src/react/` | `helpers.ts` (TanStack Query hooks, `queryKey`/`queryOptions`/`mutationOptions`), `use-publication.ts`, `types.ts` (`ReactClient<T>`), `vendor/` (adapted react-meteor-data hooks, MIT, see headers). |
| `src/codemod/` | `meteor-rpc-migrate`: the v1 → v2 codemod (TypeScript compiler API, loaded at runtime). |
| `src/index.ts` and `src/{server,client,react}/index.ts` | Entry points. `server/`, `client/`, `react/` at the root are stub `package.json` folders, because Meteor's bundler ignores `exports`. |
| `tests/unit/` | vitest against `tests/fakes/` (in-memory Meteor: DDP-like wire, merge box, Tracker, minimongo-ish stores). |
| `tests/types/` | Type-level contract (`expectTypeOf`, `@ts-expect-error`). |
| `examples/basic/` | Real Meteor 3 app consuming the packed tarball; its tests are `npm run test:meteor`. |
| `scripts/` | `consumer-check.mjs` (type-checks a packed consumer against every Meteor type provider, TS 5.9/7, zod/valibot/arktype, React 18/19 types, strict tsconfigs), `meteor-test.mjs` (real Meteor; `--client` adds the React hooks in headless Chromium), `docs-snippets.mjs` (type-checks every ts/tsx block of README.md and docs/), `mark-esm.mjs` (build step: marks `dist/esm` as ES modules). |
| `docs/`, `README.md`, `MIGRATION.md`, `CHANGELOG.md`, `CONTRIBUTING.md` | User and contributor docs. |
| `skills/migrate-to-v2/` | Agent skill shipped in the npm package, for migrating consumer apps. |

## How it works

1. **Builder** (`src/server/module.ts`). Every `add*` call validates the name, checks the schema
   implements Standard Schema, and returns a new builder over a new immutable `ModuleState`.
   Nothing touches Meteor.
2. **`build()`** (root module only; cached per state).
   - On the server, `registerModule` walks the state tree, composing dotted names and the
     middleware chain (outer first). It then registers every definition.
   - It returns a frozen router of `{ type: "method" | "publication" }` definitions.
   - The router's *type* (`ModuleBuilder<TPrefix, TRecord>`) accumulates every definition's
     input/result in phantom `~types` properties. That is what `typeof server` carries to the client.
3. **Pipeline** (`runPipeline` in `src/server/register.ts`). This is the only place calls are
   executed:
   - validate (≤ 1 argument) → middlewares → `onBeforeResolve` → resolver → `onAfterResolve`;
   - on error: `onErrorResolve`, then re-throw.

   Publications additionally publish the result (`publishResult`):
   - into one client collection per publication instance (path + input hash):
     `meteor-rpc:pub:<path>[#<hash>]`, plus `/<key>` for shared publications;
   - plus a meta document in `meteor-rpc:meta`;
   - then `ready()`.
4. **Client** (`src/client/proxy.ts`).
   - Property access builds a path.
   - On a call, if the last segment is a helper name (`subscribe`, `useQuery`, …), the helper runs
     with the definition's path. Otherwise the method `path.join(".")` is called with one argument.
     `undefined` is never sent.
   - The client never sees server values, only `import type { Server }`.
5. **React** (`src/react/`).
   - Query hooks are thin wrappers that build `queryKey: [path, input?]`.
   - `usePublication` suspends on the vendored `useSubscribeSuspense` (refcounted cache per
     connection, keyed by EJSON input). It then reads the meta document to choose the cursor or
     record shape, and reads data with the vendored `useFind` (cursor) or a Tracker-backed
     `useSyncExternalStore` (record).

## Invariants: breaking any of these is a semver-major change

1. Public exports per entry point match `tests/unit/api-surface.test.ts` (additions only).
2. Type behavior pinned in `tests/types/` stays the same (additions only).
3. Wire contract:
   - DDP name = dotted path.
   - Exactly one input argument.
   - Errors are thrown; validation errors are `Meteor.Error("validation-error", reason, ValidationIssue[])`.
   - Client collection names `meteor-rpc:pub:<path>[#<hash>][/<key>]` and `meteor-rpc:meta`. The
     hash is computed from the raw input with canonical EJSON on both sides (`publicationInstance`).
4. Hooks, middlewares and resolver contexts are single objects. Grow them by adding optional
   fields, never positional parameters.
5. Reserved names (`src/shared/names.ts`: the runtime list **and** the `ReservedName` type, kept
   in sync). New client helpers must use a name that is already reserved.

## Rules

- **Never import `meteor/*`.** Meteor runs server-side `node_modules` code with plain Node, which
  can't resolve those imports. Read packages through `fromPackage()` in `src/meteor/` instead. No
  public type may reference a Meteor type provider either. After `npm run build`,
  `grep -rn 'meteor/' dist --include='*.js' --include='*.d.ts' | grep -v '\.\./meteor/'` must
  print nothing.
- **No `@ts-ignore`.** Prefer fixing the type. `@ts-expect-error` is only for tests that assert
  errors.
- **Explicit types on every export** (`isolatedDeclarations` is on).
- **Relative imports end in `.js`** (`from "./types.js"`). The ESM-format declarations need it.
- **Target ES2020.** No `Object.hasOwn`, `.at()`, or other ES2022+ APIs (lib is ES2020).
- **Never mutate state shared across calls or builders.** Builders are immutable; hook arrays are
  copied at registration.
- **Vendored code** (`src/react/vendor/`) keeps its MIT header and a "Changes from upstream" list.
  Update both when you edit it.
- **Style.** Biome formats and lints (`npm run format`). Comments explain *why*, not what.

## Commands

| Command | Notes |
| --- | --- |
| `npm install` | Node ≥ 20 |
| `npm run check` | Everything except real Meteor. Must pass before you finish. |
| `npm test` | Unit tests (~1 s). Filter: `npx vitest run tests/unit/methods.test.ts -t "middlewares"` |
| `npm run test:types` | Type contract tests |
| `npm run typecheck` | `tsc -p tsconfig.json` (src + tests, bundler resolution) |
| `npm run build` | `tsc -p tsconfig.build.json` (CommonJS + `.d.ts`), `tsc -p tsconfig.esm.json` (ESM + `.d.ts` in `dist/esm`), then `scripts/mark-esm.mjs` |
| `npm run test:consumer` | Slow (minutes). Run it when you change public types. |
| `npm run test:docs` | Type-checks the code blocks of README.md and docs/ against the packed build. Run it when you change docs or public types. |
| `npm run test:meteor` | Needs Meteor. Run it when you change `src/server`, `src/client/transport.ts` or `src/react`. Add `-- --client` for the React hooks in headless Chromium (Playwright), `-- --release 3.6-beta.3` for another Meteor release. |

## Gotchas

- **Fake vs real Meteor.** `tests/fakes` mimics Meteor closely but not exactly: synchronous
  Tracker, naive `observe` diffs. If a test only passes against the fake, add one to
  `examples/basic`.
- **DDP turns `undefined` arguments into `null`.** That's why the transport omits the input when
  it's `undefined`.
- **Errors on the wire.** Only `Meteor.Error` survives DDP intact; other errors become a 500.
  Tests asserting messages must throw `Meteor.Error`.
- **Duplicate collections.** `new Mongo.Collection(name)` throws if the name already exists on that
  connection. Always go through `transport.collection(name)`.
- **Suspense hooks** need `QueryClientProvider`, `<Suspense>` and an error boundary in tests and
  apps.
- **Type inference** relies on `infer` over the phantom `~types` property. Don't make it optional,
  or `infer` widens to `undefined`.
- **Name checking at compile time.** `CheckName` gives TypeScript a conditional parameter type it
  infers through. Check error messages in `tests/types` when you change it.

## Before you finish a change

- [ ] `npm run check` passes. Ran `npm run test:meteor` if runtime behavior changed.
- [ ] New behavior has a unit test (and a real-Meteor test if it involves DDP, Mongo or the merge
      box). New types have a `tests/types` assertion.
- [ ] Docs updated (`docs/`, README if user-facing), and `npm run test:docs` passes. `CHANGELOG.md` has an "Unreleased" entry.
- [ ] No invariant above broken. If one must break, stop and open an issue instead.
- [ ] Don't bump versions or publish; maintainers do that (see CONTRIBUTING.md › Releasing).
