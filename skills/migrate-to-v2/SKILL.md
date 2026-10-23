---
name: meteor-rpc-migrate-to-v2
description: Migrates a Meteor app from meteor-rpc 1.x (or the grubba:rpc Atmosphere package) to meteor-rpc 2.0. Runs the meteor-rpc-migrate codemod, fixes what it reports, and verifies with tsc, tests and a Meteor run. Use when upgrading or migrating meteor-rpc to v2, or fixing errors after bumping it, such as "createMethod is not exported", "useQueryOptions does not exist", hooks or middlewares typed with a single context object, useQuery no longer suspending, "module "x" is a submodule", shared publications typed as an object, or tsc errors inside node_modules/meteor-rpc.
---

# Migrate meteor-rpc 1.x → 2.0

You are working in a Meteor app that uses meteor-rpc. The full guide ships with the package at
`node_modules/meteor-rpc/MIGRATION.md`. Below, §N refers to its sections, and every codemod
finding has an `anchor` like `MIGRATION.md#7-errors-are-thrown`. Read the linked section before
you fix an item. Don't guess the 2.0 API.

## 1. Detect

- Installed version: `meteor npm ls meteor-rpc` and `package.json`. Atmosphere package:
  `grep -n "grubba:rpc" .meteor/packages`.
- Meteor version: `.meteor/release`. 2.0 needs Meteor 3.0+. If the app is on 2.x, stop and tell
  the user.
- Usage: `grep -rn -e "meteor-rpc" -e "grubba:rpc" --exclude-dir=node_modules --exclude-dir=.meteor .`
  Note the client file (`createClient<Server>()`), the root module (`createModule()…build()`)
  and the submodules.
- Type provider: `@types/meteor` in package.json, `zodern:types` in `.meteor/packages`, or
  Meteor 3.6 native types (`.meteor/types`, `meteor types`). All three work with 2.0.
- Validator: `meteor npm ls zod`. 2.0 needs zod ≥ 3.24 (or valibot ≥ 1, arktype ≥ 2).
- Baseline: run the typecheck and tests from step 5 now and save the output. You need it to tell
  errors you introduce from errors that were already there.

## 2. Install (§2, §3)

```bash
meteor npm install meteor-rpc@2 @tanstack/react-query
meteor npm install zod@latest            # only if zod < 3.24
meteor remove grubba:rpc                 # only if it's in .meteor/packages
meteor npm ls react @tanstack/react-query  # must show one copy of each
```

Remove workarounds added for 1.x type errors (§3): `paths` entries for meteor-rpc,
`@ts-ignore` / `@ts-expect-error` on its imports, and `skipLibCheck` if it was turned on only for
meteor-rpc. Ask the user before changing `skipLibCheck` if you can't tell why it's on.

## 3. Run the codemod

```bash
npx -y -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate --json imports client server
```

- Pass every directory with app code, including `packages` if local packages use meteor-rpc.
  It skips node_modules, .meteor, dist, build and .git.
- Without `--write` it's a dry run. Read the JSON: each entry has `file`, `line`, `column`,
  `kind` ("change" or "manual"), `message` and `anchor`. Then apply the changes once:
  `npx -y -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate --write imports client server`.
- Run `--write` only once. A second run would rename `useQuery` calls you wrote for 2.0 into
  `useSuspenseQuery`.
- If it can't load TypeScript, use the exact npx command above. TypeScript 7 has no JavaScript API.
- It changes: `api.x.useQuery(input, { useQueryOptions: o })` → `api.x.useSuspenseQuery(input, o)`,
  `(raw, parsed) => …` hooks and middlewares → `({ raw, parsed }) => …`, and
  `"meteor/grubba:rpc"` imports → `"meteor-rpc"`. Review the result with `git diff`.
- **Keeping `useQuery` (fewer changes).** Add `--suspense-client` to both runs: it keeps the
  `useQuery` calls (only unwrapping `{ useQueryOptions }`) and creates the React client with
  `{ suspense: true }`, so they keep suspending like 1.x. Ask the user if you can't tell which they
  prefer: the renamed `useSuspenseQuery()` reads clearer, `--suspense-client` touches less code.

## 4. Fix the manual items

Fix every `"manual"` item. The usual fixes:

| Finding | Fix |
| --- | --- |
| `createMethod` / `createQuery` / `createMutation` removed | Move it into a module: `createModule().addMethod(name, schema, resolver, config)` (§11) |
| `createPublication` / `createRealtimeQuery` removed | `addPublication`. On the client, use `api.x.usePublication(input)`, or `api.x.subscribe(input)` and `api.x.collection(input)` without React (§9) |
| `createSharedRealtimeQuery` removed, or a shared publication returns an array | `addSharedPublication(name, schema, (input) => ({ rooms: Rooms.find(), users: Users.find() }))`. Pick a key per cursor, then update the client: `data.rooms`, `data.users` (§10) |
| `createSafeCaller` removed | `const api = createClient<Server>(); await api.name(args)`. In server code inside a module, `await createCaller(module).name(args)` (§13) |
| `ReturnMethod`, `ReturnSubscription`, `Config`, `SubscriptionCallbacks` | `MethodDefinition`, `PublicationDefinition`, `MethodConfig` / `PublicationConfig`, `SubscribeCallbacks` |
| `addBeforeResolveHook` / `addAfterResolveHook` / `addErrorResolveHook` | Move the hook into the method's `config.hooks`, or use `addMiddlewares`. Take one context: `({ raw, parsed, result, error })` (§5) |
| `setResolver`, `expect<T>()`, `returns<T>()` | Pass the resolver to `addMethod`. Drop `expect` / `returns`; annotate the resolver's return type if needed (§11) |
| Hook passed by reference, rest or default parameters, config defined in another file | Change that function's signature to take one object: `({ raw, parsed })`, `({ raw, parsed, result })` or `({ error, raw, parsed })` (§5) |
| `build()` on `createModule("ns")` | End it with `.buildSubmodule()`, add it to the root with `.addSubmodule(x)`, and call `.build()` on the root only (§12) |
| `onErrorResolve` | Errors are re-thrown after the hooks run. Find the callers that relied on the old behavior (a method resolving with `undefined`) and add try/catch there. Otherwise nothing changes (§7) |
| `__isError__` | Delete the envelope check. Wrap the call in try/catch and use `isMeteorError` / `isValidationError` from meteor-rpc (§7) |
| `useQuery()` with options other than `useQueryOptions` | `useSuspenseQuery(input, options)` keeps the 1.x suspense behavior. Only switch to the non-suspending `useQuery` if the component handles `isPending` and `data` being `undefined` (§8) |
| Could not parse this file | Migrate that file by hand using the same rules |

The codemod can't see these. Search for them yourself:

- **Middleware order (§6).** In 1.x a submodule's middlewares ran before its parent's. In 2.0
  the root runs first. Check any middleware that depends on another one having run.
- **Publications now run middlewares, hooks and `rateLimit` (§6).** A middleware written for
  methods may need `if (ctx.type === "method")`.
- **Calling methods on the server (§13).** `server.foo()` and `someModule.submodule.foo()` (1.x
  method objects) no longer work. Use `createCaller(someModule).foo()` from `meteor-rpc/server`,
  not `createClient<Server>()`, which makes `Server` circular inside its own modules.
- **Client collections (§9).** Code that opened `new Mongo.Collection("<publication name>")` on
  the client to read a publication's documents must use the `collection` returned by
  `usePublication`, or `api.x.collection(input)` (`api.x.collections(input)` for shared
  publications).
- **Reserved names (§12).** Methods, publications or submodules named `subscribe`, `collection`,
  `collections`, `queryKey`, `queryOptions`, `mutationOptions`, `use` + an uppercase letter, `$…`, or containing
  a dot must be renamed, on the server and in every caller.
- **Silent failures.** Every failed call now throws. Callers that checked for `undefined` or an
  error object need try/catch, or an `onError` on `useMutation`.

## 5. Verify

Don't report the migration as done until these pass:

1. **Typecheck.** Use `meteor npm run typecheck` if the script exists, otherwise
   `npx tsc --noEmit -p .`. You need zero errors under `node_modules/meteor-rpc` and no new errors
   compared with the baseline. Fix the causes. Don't add `any`, `@ts-ignore` or `skipLibCheck`.
   If errors still point into `node_modules/meteor-rpc`, delete `node_modules` and reinstall:
   a 1.x copy is still there.
2. **Leftovers.** This should print nothing:
   `grep -rn -e "useQueryOptions" -e "__isError__" -e "createMethod" -e "createSafeCaller" -e "grubba:rpc" --exclude-dir=node_modules --exclude-dir=.meteor .`
3. **Tests.** Run the app's test script, for example `meteor npm test`. Compare the results with
   the baseline.
4. **Smoke run.** If you can run `meteor`, start it and wait for "App running at". Watch the
   server output for startup errors such as `module "x" is a submodule`,
   `rateLimit needs the ddp-rate-limiter package` (fix with `meteor add ddp-rate-limiter`),
   `the schema of "x" is not a Standard Schema`, or reserved-name errors. If you have a browser,
   load a page that runs a query, a mutation and a publication. Then stop the app.

Report:

- What the codemod changed.
- The decisions you made, such as the key names for shared publications, the error handling you
  added, and `useQuery` vs `useSuspenseQuery`.
- Anything you couldn't verify, and why (for example: no tests, or Meteor can't run here).

## Gotchas

- Middlewares run from the root module down. In 1.x the innermost module's middlewares ran first.
- Errors are always thrown, including after `onErrorResolve`. A `Meteor.Error` reaches the
  client unchanged. Any other error arrives as "Internal server error". Invalid input throws
  `Meteor.Error("validation-error")` with the issues in `details`.
- `api.x.useQuery()` no longer suspends, unless the client is created with `{ suspense: true }`.
  The codemod turned 1.x calls into `useSuspenseQuery()` (or kept them with `--suspense-client`),
  which still needs a `<Suspense>` boundary. The default `useQuery()` doesn't.
- Shared publications return `{ key: cursor }`. Each key gets its own client collection, and
  `usePublication` returns `{ data: { key: [...] }, collections }`.
- Some names are reserved (see §12). Registration happens in `build()`, so a module that is
  never built registers nothing.
- "Invalid hook call" or "No QueryClient set" means there are two copies of React or TanStack
  Query. Dedupe them (`meteor npm ls react @tanstack/react-query`).
