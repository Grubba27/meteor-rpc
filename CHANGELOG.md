# Changelog

All notable changes to this project are documented here. The project follows
[semver](https://semver.org); see [CONTRIBUTING.md › Versioning](./CONTRIBUTING.md#versioning).

## 2.0.0 (unreleased)

A rewrite that makes meteor-rpc type-check everywhere, work with any validator, and fixes the
runtime bugs of 1.x. Upgrade guide: [MIGRATION.md](./MIGRATION.md). There's a codemod
(`meteor-rpc-migrate`) and an agent skill (`skills/migrate-to-v2`).

### Breaking

- **Packaging**
  - Ships compiled JavaScript + `.d.ts` instead of TypeScript sources: CommonJS for Meteor's
    classic bundler and the server, ES modules (`import` condition) for Rspack and other bundlers.
  - React and @tanstack/react-query are optional peer dependencies; zod is no longer a dependency.
  - Requires Meteor 3.0+ and TypeScript 5.0+.
  - The Atmosphere package `grubba:rpc` is discontinued.
- **API**
  - Hooks and middlewares receive one context object (`({ raw, parsed, result, error, userId, name, … })`).
  - Middlewares run outer module first, and also apply to publications. So do hooks and rate limits.
  - Method errors are always thrown, never returned or swallowed. Invalid input throws
    `Meteor.Error("validation-error")` with the issues in `details`.
  - `useQuery` no longer suspends (TanStack semantics). Use `useSuspenseQuery`, which replaces
    1.x `useQuery(input, { useQueryOptions })`.
  - `addSharedPublication` resolvers return named cursors (`{ rooms, users }`). `usePublication`
    returns data per key.
  - Each (publication, input) pair has its own client collection (`meteor-rpc:pub:…`), so data from
    different inputs never mixes.
  - `build()` only on the root module. Registration happens at `build()`.
- **Removed exports**
  - `createMethod`, `createQuery`, `createMutation`, `createPublication`, `createRealtimeQuery`,
    `createSharedRealtimeQuery`, `createSafeCaller`.
  - The method-object helpers `addBeforeResolveHook`, `addAfterResolveHook`, `addErrorResolveHook`,
    `setResolver`, `expect` and `returns`.

### Added

- Any [Standard Schema](https://standardschema.dev) validator: zod 3.24+ and 4, valibot, arktype,
  and others (#11, #14).
- Entry points `meteor-rpc/server`, `meteor-rpc/client` (no React) and `meteor-rpc/react`.
- Client helpers:
  - `useQuery` (non-suspense), `useSuspenseQuery`, `queryKey`, `queryOptions`, `mutationOptions`
  - `subscribe`, `collection(input)` and `collections(input)` for non-React code
  - `createClient({ connection })` for other DDP servers and server-side tests
- Resolver context: `(input, { userId, connection, name, invocation | subscription })`, and `this`
  is bound in methods.
- `isValidationError`, `isMeteorError` and `VALIDATION_ERROR`.
- Compile-time checks for reserved, dotted and duplicate names, and for `build()` /
  `buildSubmodule()` misuse.
- Works with React 19 (#7) and Meteor 3.6 native types.

### Fixed

- Type errors inside `node_modules/meteor-rpc` in consumer apps (#10).
- `usePublication` re-subscribing in a loop with object input (#8).
- Nested submodules registering under the wrong name.
- `mutate()` on methods without input sending `null`.
- Shared publications: documents of different collections overwriting each other, and `ready`
  firing before the data (#6).
- Rate limiting crashing when `ddp-rate-limiter` wasn't added directly by the app.
- `build()` applying middlewares again on every call, and hooks leaking between methods that
  shared a config object.

## 1.1.0 and earlier

See the [GitHub releases](https://github.com/Grubba27/meteor-rpc/releases) and the git history.
