# Contributing

Thanks for helping! This page covers the commands, how the code is organized, and the rules that
keep 2.x free of breaking changes. Coding agents: also read [AGENTS.md](./AGENTS.md).

## Setup

```bash
git clone https://github.com/Grubba27/meteor-rpc.git
cd meteor-rpc
npm install
npm run check
```

Node 20 or later. You need Meteor only for `npm run test:meteor`.

## Commands

| Command | What it does | Needs Meteor |
| --- | --- | --- |
| `npm run check` | lint + typecheck + unit tests + type tests + build + consumer type-check + docs snippets. Run it before every PR. | no |
| `npm run lint` / `npm run format` | Biome check / auto-fix | no |
| `npm run typecheck` | `tsc` on `src` and `tests` | no |
| `npm test` | Unit tests (vitest) against an in-memory fake of Meteor (`tests/fakes`) | no |
| `npm run test:types` | Type-level tests (`tests/types`): the public API's type contract | no |
| `npm run build` | Compiles `src` to `dist` (CommonJS + `.d.ts`) | no |
| `npm run test:consumer` | Packs the library and type-checks a consumer app against every Meteor type provider and TypeScript 5.9 / 7 | no |
| `npm run test:docs` | Type-checks every `ts`/`tsx` code block in README.md and `docs/` against the packed build | no |
| `npm run test:meteor` | Packs the library into `examples/basic` and runs its integration tests in a real Meteor. `-- --client` adds the React hook tests in headless Chromium; `-- --release <name>` runs on another Meteor release too. | yes |

## Where things go

- **Bug fixes** need a failing test first. Use `tests/unit` when the fake Meteor can show the bug,
  and `examples/basic/tests` when it needs real Meteor (DDP, Mongo, merge box).
- **Type changes** need an assertion in `tests/types`.
- **Behavior changes** need docs in `docs/` and an entry in `CHANGELOG.md` under "Unreleased".

## Versioning

meteor-rpc follows [semver](https://semver.org). 2.0 was the planned breaking release: it made
every shape extensible so 2.x can grow without breaking users. Before 3.0, **removing or renaming
any of these is not allowed**:

- **Exports.** Every export of `meteor-rpc`, `meteor-rpc/server`, `meteor-rpc/client` and
  `meteor-rpc/react`, as recorded in `tests/unit/api-surface.test.ts`. Adding exports is fine;
  update the snapshot.
- **Type behavior** pinned in `tests/types` (inputs, results, hooks, errors, compile-time checks).
- **Wire behavior:**
  - DDP names are dotted paths.
  - One input argument per call.
  - `validation-error` errors carry `details: ValidationIssue[]`.
  - Client collection names `meteor-rpc:pub:<path>[#<input hash>][/<key>]`, plus the
    `meteor-rpc:meta` collection (`src/shared/names.ts`).
- **Reserved names** (`src/shared/names.ts`). New client helpers must use a name that is already
  reserved: `use[A-Z]*`, `$*`, or the fixed list.

How to grow without breaking:

- **Context objects.** Add optional fields to the context passed to resolvers, middlewares and
  hooks. Never add positional parameters.
- **Options and config.** Add optional fields to `MethodConfig`, `PublicationConfig` and
  `ClientOptions`, or add optional trailing parameters.
- **New features.** Add new builder methods or client helpers, using reserved names.
- **Peer dependencies.** Widen ranges (e.g. `@tanstack/react-query` 6) only if the types stay
  compatible. Otherwise it waits for 3.0.

If a change would break any of the above, open an issue first.

## Releasing (maintainers)

1. Move "Unreleased" in `CHANGELOG.md` to the new version, and bump `package.json`.
2. Run `npm run check` and `npm run test:meteor -- --client --release <latest Meteor beta>`.
3. Publish: `npm publish` for stable releases, `npm publish --tag next` for prereleases. Never
   publish a prerelease without a tag, or it becomes `latest`.
