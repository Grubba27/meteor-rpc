# Migrating from meteor-rpc 1.x to 2.0

meteor-rpc 2.0 is the one breaking release we plan. Everything that needed a breaking change
was done here, and 2.x follows strict semver from now on (see [Versioning](./CONTRIBUTING.md#versioning)).

Most of the work is mechanical. Run the codemod first, then go through the checklist for what it
can't do safely.

- [Why upgrade](#why-upgrade)
- [Automated migration](#automated-migration)
- [Checklist](#checklist)
  1. [Requirements](#1-requirements)
  2. [Install](#2-install)
  3. [TypeScript setup](#3-typescript-setup)
  4. [Imports](#4-imports)
  5. [Hooks and middlewares take one context object](#5-hooks-and-middlewares-take-one-context-object)
  6. [Middlewares run outer module first and also guard publications](#6-middlewares-run-outer-module-first-and-also-guard-publications)
  7. [Errors are thrown](#7-errors-are-thrown)
  8. [React: useQuery vs useSuspenseQuery](#8-react-usequery-vs-usesuspensequery)
  9. [Publications](#9-publications)
  10. [Shared publications return named cursors](#10-shared-publications-return-named-cursors)
  11. [Removed exports](#11-removed-exports)
  12. [build() and buildSubmodule()](#12-build-and-buildsubmodule)
  13. [Calling methods from the server](#13-calling-methods-from-the-server)
- [Troubleshooting](#troubleshooting)

## Why upgrade

- **Your `tsc` stops failing inside `node_modules/meteor-rpc`** ([#10](https://github.com/Grubba27/meteor-rpc/issues/10)).
  2.0 ships compiled JavaScript and `.d.ts` files that don't depend on which Meteor types you use:
  `@types/meteor`, `zodern:types`, or the native types from Meteor 3.6's `meteor types`.
- **Any validator.** Schemas can come from any [Standard Schema](https://standardschema.dev) library:
  zod 3.24+ and 4 ([#11](https://github.com/Grubba27/meteor-rpc/issues/11)), valibot, arktype, and others.
- **React 19** works ([#7](https://github.com/Grubba27/meteor-rpc/issues/7)): React and TanStack Query
  are peer dependencies now, so you never get a second copy of React.
- **Fixed runtime bugs.**
  - Errors reach the caller.
  - Middlewares, hooks and rate limits apply to publications.
  - Nested submodules get the right names.
  - `usePublication` no longer re-subscribes in a loop ([#8](https://github.com/Grubba27/meteor-rpc/issues/8)).
  - Shared publications keep each collection's documents apart ([#6](https://github.com/Grubba27/meteor-rpc/issues/6)).

## Automated migration

```bash
npx -y -p typescript@5.9 -p meteor-rpc@2 meteor-rpc-migrate imports client server
```

The codemod only prints what it would change. Review the output, then run it again with
`--write`. Add `--json` for machine-readable output (handy for coding agents), or `--check` to
exit with code 1 while anything is left to change or review.

It handles:

- `api.x.useQuery(input, { useQueryOptions: options })` → `api.x.useSuspenseQuery(input, options)`, and `typeof api.x.useQuery` in types ([§8](#8-react-usequery-vs-usesuspensequery))
- Test doubles of the client: `useQuery` keys in `vi.mock` / `jest.mock` factories → `useSuspenseQuery`, and `{ useQueryOptions: o }` → `o` in `toHaveBeenCalledWith` assertions
- `(raw, parsed) => …` hooks and middlewares → `({ raw, parsed }) => …` ([§5](#5-hooks-and-middlewares-take-one-context-object))
- `someModule.submodule.method()` → `createCaller(someModule).method()` ([§13](#13-calling-methods-from-the-server))
- `"meteor/grubba:rpc"` and `"grubba-rpc"` imports (and mocks) → `"meteor-rpc"` ([§2](#2-install))

It follows the client and modules across files: relative imports, Meteor absolute imports
(`/imports/...`), and the `paths` aliases of your `tsconfig.json` (`@/imports/...`).

With `--suspense-client` it keeps your `useQuery` calls and their test doubles instead: it only
unwraps `{ useQueryOptions }`, and creates the React client with `{ suspense: true }` so they keep
suspending ([§8](#8-react-usequery-vs-usesuspensequery)).

> **Run `--write` once, on 1.x code.** The codemod can't tell a 1.x `useQuery` (which suspended)
> from a 2.0 `useQuery` (which doesn't). Running it again after you wrote new 2.0 code would rename
> those calls to `useSuspenseQuery` too.

It reports, with file and line, everything that needs a human: removed exports, method-object
hooks, `build()` on a namespaced module, shared publications that return arrays, and error hooks
that used to swallow errors.

Using a coding agent? The package ships a skill that runs the codemod and walks through this
checklist: point your agent at `node_modules/meteor-rpc/skills/migrate-to-v2/SKILL.md`.

## Checklist

### 1. Requirements

| | 1.x | 2.0 |
| --- | --- | --- |
| Meteor | 2.x / 3.x | **3.0+** |
| React (only for `meteor-rpc/react` and the root import) | bundled 18 | **18.2+ or 19**, your copy |
| @tanstack/react-query | bundled 5 | **5.x**, your copy |
| Validator | zod 3 | **any Standard Schema**: zod ≥ 3.24, valibot ≥ 1.0, arktype ≥ 2.0, … |
| TypeScript | 4.7+ | **5.0+** (tested on 5.9 and 7.0) |

### 2. Install

```bash
meteor npm install meteor-rpc@2 @tanstack/react-query zod
```

React, React DOM and TanStack Query are now peer dependencies. Your app already has React; check
that only one copy is installed:

```bash
meteor npm ls react
```

Using zod older than 3.24? Upgrade it (`meteor npm install zod@latest`). Older versions don't
implement Standard Schema.

If you used the Atmosphere package `grubba:rpc`, remove it (`meteor remove grubba:rpc`). 2.0 is
npm only. If you used the npm package `grubba-rpc` (meteor-rpc's earlier name), uninstall it
(`meteor npm uninstall grubba-rpc`): the codemod rewrites its imports to `meteor-rpc`.

### 3. TypeScript setup

Remove any workaround you added for meteor-rpc errors: `paths` overrides, `// @ts-ignore`s
around its imports, or `skipLibCheck` turned on just for it. Nothing in meteor-rpc's types
depends on your Meteor type provider, so all of these work:

- `@types/meteor`
- `zodern:types`
- Meteor 3.6 native types (`meteor types` plus the tsconfig from the Meteor guide)

### 4. Imports

`import { createModule, createClient } from "meteor-rpc"` still works. The root import needs React
and TanStack Query. New subpath imports let you avoid loading React where you don't need it:

| Import | Use for | Needs React |
| --- | --- | --- |
| `meteor-rpc` | everything (same as 1.x) | yes |
| `meteor-rpc/server` | `createModule`, server types | no |
| `meteor-rpc/client` | `createClient` without hooks (Blaze, Vue, Svelte, scripts) | no |
| `meteor-rpc/react` | `createClient` with TanStack Query and publication hooks | yes |

Keep importing the server type with `import type`, so server code never reaches the client bundle:

```ts
import type { Server } from "/imports/api/server";
```

### 5. Hooks and middlewares take one context object

Every hook and middleware now receives a single object. New fields can be added later without
another breaking change. The codemod rewrites inline functions.

```ts
// 1.x
.addMiddlewares([(raw, parsed) => log(raw, parsed)])
.addMethod("save", schema, save, {
  hooks: {
    onBeforeResolve: [(raw, parsed) => {}],
    onAfterResolve: [(raw, parsed, result) => {}],
    onErrorResolve: [(err, raw, parsed) => {}],
  },
})

// 2.0
.addMiddlewares([({ raw, parsed }) => log(raw, parsed)])
.addMethod("save", schema, save, {
  hooks: {
    onBeforeResolve: [({ raw, parsed }) => {}],
    onAfterResolve: [({ raw, parsed, result }) => {}],
    onErrorResolve: [({ error, raw, parsed }) => {}],
  },
})
```

The context also carries:

- `type`: `"method"` or `"publication"`
- `name`: the full name, e.g. `"chat.send"`
- `userId`
- `connection`
- `invocation` (methods) or `subscription` (publications)

So you can write auth middlewares without calling `Meteor.userId()`.

Method-level helpers are gone: `method.addBeforeResolveHook(fn)`, `addAfterResolveHook` and
`addErrorResolveHook`. Pass hooks in the method's `config.hooks`, or use a module middleware.

### 6. Middlewares run outer module first and also guard publications

- **Order.** In 1.x a submodule's middlewares ran before its parent's. In 2.0 they run from the
  root module down, in the order you added them, like most middleware systems. So an auth check
  on the root runs first.
- **Publications.** In 1.x, middlewares, `hooks` and `rateLimit` were silently ignored for
  publications. In 2.0 they apply. Check that your middlewares make sense for subscriptions; the
  context's `type` tells them apart.

### 7. Errors are thrown

In 1.x a failing method returned an object (`{ __isError__: true, … }`), and only the React
client turned it back into an error. If you had `onErrorResolve` hooks, the error was swallowed
and the method resolved with `undefined`.

In 2.0:

- **Every failure throws.** Error hooks run first, then the error is re-thrown.
- **`Meteor.Error`s reach the client unchanged** (`error`, `reason`, `details`). Other errors arrive
  as Meteor's generic "Internal server error", as with plain Meteor methods.
- **Invalid input throws `Meteor.Error("validation-error")`** with the issues in `details`:

```ts
import { isValidationError } from "meteor-rpc";

try {
  await api.users.create(form);
} catch (error) {
  if (isValidationError(error)) {
    for (const issue of error.details) setFieldError(issue.path.join("."), issue.message);
  } else throw error;
}
```

If you relied on errors being swallowed, catch them where you call the method.

### 8. React: useQuery vs useSuspenseQuery

In 1.x `api.x.useQuery()` suspended, unlike TanStack Query's own `useQuery`. 2.0 follows TanStack
Query's names. The codemod renames existing calls, so behavior doesn't change.

| 1.x | 2.0 |
| --- | --- |
| `api.x.useQuery(input)` (suspends) | `api.x.useSuspenseQuery(input)` |
| `api.x.useQuery(input, { useQueryOptions: options })` | `api.x.useSuspenseQuery(input, options)` |
| — | `api.x.useQuery(input, options)`: doesn't suspend; returns `isPending`, `data \| undefined` |
| — | `api.x.queryKey(input?)`, `api.x.queryOptions(input, options?)`, `api.x.mutationOptions(options?)` |

**Fewer changes: keep `useQuery` suspending.** Create the client with `{ suspense: true }`. Every
`useQuery` then suspends like in 1.x, so its `data` is always defined, and only the options change:

```ts
export const api = createClient<Server>({ suspense: true });

const { data } = api.todos.list.useQuery({ listId }, { refetchInterval: 5000 }); // was { useQueryOptions: { … } }
```

`meteor-rpc-migrate --suspense-client` makes exactly these changes. Types such as
`ReturnType<typeof api.todos.list.useQuery>["data"]` keep working.

Invalidate after a mutation with the new `queryKey` helper:

```ts
const queryClient = useQueryClient();
const add = api.todos.add.useMutation({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: api.todos.list.queryKey() }),
});
```

Methods without input can now be mutated with `mutate()`. In 1.x this sent `null` and failed
`z.void()` validation.

### 9. Publications

- **Data comes back the same way.** `usePublication(input)` still returns `{ data, collection }`
  for `addPublication`.
- **One client collection per input.** In 1.x, documents went to a client collection named exactly
  like the publication. That name could clash with your real collections, and two subscriptions
  with different input saw each other's documents. 2.0 gives each (publication, input) pair a
  client collection of its own (`meteor-rpc:pub:…`). Don't depend on the name: use the
  `collection` returned by `usePublication`, or `api.x.collection(input)`.
- **Returning nothing is allowed.** A resolver can return `undefined` (for example, when the user
  isn't allowed). The subscription becomes ready with no documents.
- **Readiness waits for data.** `ready` now fires after the initial documents arrived.
- **No more manual collections.** In 1.x, `createRealtimeQuery(...).useRealtime()` made you manage
  collections yourself. In 2.0, `api.x.subscribe(input, callbacks)` and `api.x.collection(input)`
  work without React. For shared publications, use `api.x.collections(input)`.

### 10. Shared publications return named cursors

1.x merged every cursor into one client collection, so documents from different collections with
the same `_id` overwrote each other. 2.0 gives each cursor a name and a collection of its own.

```ts
// 1.x
.addSharedPublication("room", z.string(), (roomId) => [
  Rooms.find({ _id: roomId }),
  Messages.find({ roomId }),
])
const { data } = api.room.usePublication(roomId); // (Room | Message)[]

// 2.0
.addSharedPublication("room", z.string(), (roomId) => ({
  room: Rooms.find({ _id: roomId }),
  messages: Messages.find({ roomId }),
}))
const { data } = api.room.usePublication(roomId); // { room: Room[]; messages: Message[] }
const { room, messages } = data;
```

The codemod reports these resolvers; pick a key name for each cursor.

### 11. Removed exports

| 1.x | 2.0 |
| --- | --- |
| `createMethod(name, schema, resolver, config)` | `createModule().addMethod(name, schema, resolver, config)` |
| `createQuery`, `createMutation` (aliases of `createMethod`) | `addMethod` |
| `createPublication`, `createRealtimeQuery` | `addPublication` |
| `createSharedRealtimeQuery` | `addSharedPublication` ([§10](#10-shared-publications-return-named-cursors)) |
| `createSafeCaller<T>().call(name, args)` | `createClient<Server>()` then `api.name(args)`; in server code inside a module, `createCaller(module).name(args)` ([§13](#13-calling-methods-from-the-server)) |
| `method.addBeforeResolveHook` / `addAfterResolveHook` / `addErrorResolveHook` | `config.hooks` or `addMiddlewares` ([§5](#5-hooks-and-middlewares-take-one-context-object)) |
| `method.setResolver(fn)` | Pass the resolver to `addMethod`. Server code doesn't reach the client as long as the client uses `import type`. |
| `method.expect<T>()`, `method.returns<T>()` | Not needed: the result type is inferred from the resolver. Annotate the resolver's return type if you want to pin it. |
| `ReturnMethod`, `ReturnSubscription`, `Config`, `SubscriptionCallbacks` types | `MethodDefinition`, `PublicationDefinition`, `MethodConfig` / `PublicationConfig`, `SubscribeCallbacks` |

### 12. build() and buildSubmodule()

- **`build()` is for the root module** (`createModule()` without a namespace). In 1.x,
  `createModule("chat")...build()` registered `chat.x` while the client called `x`, so it never
  worked. In 2.0 it throws and doesn't compile. Use `buildSubmodule()` and `addSubmodule()`.
- **Registration happens in `build()`**, not in `addMethod`. A module you never `build()` registers
  nothing. Calling `build()` twice returns the same router and doesn't register twice.
- **Nested submodules get full names.** `createModule("chat").addSubmodule(messages)` registers
  `chat.messages.send`, matching what the client calls. In 1.x the server registered
  `messages.send` and calls failed.
- **Some names are reserved.** These can't be used for methods, publications or submodules,
  because the client uses them for helpers:
  - `subscribe`, `collection`, `collections`, `queryKey`, `queryOptions`, `mutationOptions`
  - any name starting with `use` followed by an uppercase letter
  - any name starting with `$`
  - names containing a dot

  TypeScript flags them as you type.

### 13. Calling methods from the server

1.x method objects could be called directly on the server: `await server.foo()`, or
`await usersModule.submodule.getUser()` from another module. In 2.0 `build()` and
`buildSubmodule()` return a plain description of your API, so use `createCaller`:

The codemod rewrites `someModule.submodule.method()` calls when it can find the module's
`buildSubmodule()`, and reports the others.

```ts
import { createCaller } from "meteor-rpc/server";

// 1.x: await usersModule.submodule.getUser();
const user = await createCaller(usersModule).getUser();
// 1.x: await server.foo(); (outside the modules, for example in a job)
await createCaller(server).foo();
```

Calls run through `Meteor.callAsync`, with validation, middlewares and hooks, like in 1.x. Inside a
method they keep its `userId`. Inside a module, pass another module: neither the root router nor
`createClient<Server>()` can be typed from inside the module tree, because `Server` would refer to
itself (TS7022, TS2456). When modules import each other, create the caller inside the resolver.
Outside the module tree (scripts, cron jobs) `createClient<Server>()` from `meteor-rpc/client`
works too. More in [Server › Calling other modules from the server](./docs/server.md#calling-other-modules-from-the-server).

## Troubleshooting

- **"Invalid hook call" or "No QueryClient set".** There are two copies of React or TanStack Query.
  Run `meteor npm ls react @tanstack/react-query` and dedupe.
- **"the schema of "x" is not a Standard Schema".** Upgrade zod to 3.24 or later, valibot to 1.0 or
  later, or arktype to 2.0 or later.
- **"`rateLimit` needs the ddp-rate-limiter package".** Run `meteor add ddp-rate-limiter`.
- **"module "x" is a submodule".** See [§12](#12-build-and-buildsubmodule).
- **Type errors still point inside `node_modules/meteor-rpc`.** Delete `node_modules` and reinstall:
  an old 1.x copy (which shipped `.ts` sources) is still around.
