---
name: meteor-rpc
description: Writes end-to-end type-safe Meteor methods and publications with meteor-rpc 2 and uses them from React through its TanStack Query and publication hooks. Use when adding or changing a Meteor method, publication or RPC endpoint in an app that depends on meteor-rpc, calling a method or subscribing to a publication from a React component, or writing code with createModule, addMethod, addPublication, createClient, useMutation, useSuspenseQuery or usePublication. To upgrade from meteor-rpc 1.x, use the meteor-rpc-migrate-to-v2 skill instead.
---

# Methods, publications and React with meteor-rpc 2

meteor-rpc replaces `Meteor.methods`, `Meteor.publish`, `Meteor.callAsync` and `useTracker` +
`Meteor.subscribe`: write new endpoints with it. It needs Meteor 3 and meteor-rpc 2
(`meteor npm ls meteor-rpc`). `templates/` next to this file has complete, type-checked files.
Reference: `node_modules/meteor-rpc/README.md` and
[the docs](https://github.com/Grubba27/meteor-rpc/tree/main/docs).

## 1. Find the existing setup

- Reuse the root module (`grep -rn "createModule()" imports server`) and the client
  (`grep -rn "createClient<" imports client`), and the app's validator (any Standard Schema).
- None yet: copy `templates/` (each file's first line says where it goes), then
  `meteor npm install meteor-rpc zod @tanstack/react-query react-error-boundary`.

## 2. Server: one module per feature

```ts
// imports/api/server.ts (server only: `server/main.ts` does `import "/imports/api/server";`)
import { Meteor } from "meteor/meteor";
import { createModule, type Middleware } from "meteor-rpc/server";
import { z } from "zod";
import { Lists, Tasks } from "./collections"; // Mongo.Collection<List>, Mongo.Collection<Task>

const requireUser: Middleware = ({ userId }) => {
  if (!userId) throw new Meteor.Error("not-authorized", "Log in first");
};

const tasks = createModule("tasks") // DDP names "tasks.add", "tasks.byList", …
  .addMiddlewares([requireUser]) // runs before every method AND publication below
  .addMethod(
    "add",
    z.object({ listId: z.string(), title: z.string().trim().min(1, "Title is required") }),
    (input, { userId }) =>
      Tasks.insertAsync({ ...input, done: false, ownerId: userId!, createdAt: new Date() }),
    {
      rateLimit: { limit: 5, interval: 1000 }, // needs `meteor add ddp-rate-limiter`
      hooks: { onErrorResolve: [({ name, error }) => console.error(name, error)] },
    },
  )
  .addMethod("stats", z.object({ listId: z.string() }), async ({ listId }) => ({
    open: await Tasks.find({ listId, done: false }).countAsync(),
  }))
  .addPublication("byList", z.object({ listId: z.string() }), ({ listId }) =>
    Tasks.find({ listId }, { sort: { createdAt: -1 } }),
  )
  .addSharedPublication("overview", z.void(), (_input, { userId }) => ({
    lists: Lists.find({ ownerId: userId! }),
    recent: Tasks.find({ ownerId: userId! }, { sort: { createdAt: -1 }, limit: 5 }),
  }))
  .buildSubmodule(); // a namespaced module: never .build()

const server = createModule() // the root module
  .addMethod("ping", z.void(), () => "pong" as const)
  .addSubmodule(tasks)
  .build(); // registers everything with Meteor; only the root calls it

export type Server = typeof server;
```

As the API grows, put each feature module in its own file (`templates/module.ts`).

- **Input.** One argument, validated by the schema; `z.void()` means none (`api.ping()`). The
  client sends the schema's input type; the resolver gets its output (trimmed, defaulted, …).
- **Resolver** `(input, context)`: `context` has `type`, `name`, `userId`, `connection`. A
  `function` also gets Meteor's `this` (`this.unblock()`, …). Return EJSON-serializable values.
- **Errors.** Throw `new Meteor.Error(code, reason)` for users; anything else arrives as
  "Internal server error". The schema already validates the input: no `check()`.
- **Publications** return one cursor (or nothing); shared ones return `{ key: cursor }`.
  meteor-rpc publishes them and marks the subscription ready.
- **Middlewares and hooks take ONE context object.** Middlewares run for methods *and*
  publications, root module first. Hooks: `onBeforeResolve`, `onAfterResolve` (`result`),
  `onErrorResolve` (`error`, re-thrown afterwards).
- **Calling another module from server code**: `await createCaller(usersModule).getUser(input)`
  (`meteor-rpc/server`). It runs the full pipeline with the caller's `userId`. Never
  `createClient<Server>()` inside a module: it makes `Server` circular.
- **Names.** No dots, unique per module, not reserved: `subscribe`, `collection`, `collections`,
  `queryKey`, `queryOptions`, `mutationOptions`, `use` + uppercase letter, `$…`, `then`, `catch`,
  `finally`, `toJSON`, `toString`, `valueOf`, `prototype`, `constructor`.

## 3. Client: exactly one, typed from the server

```ts
// imports/api/client.ts
import { createClient } from "meteor-rpc/react"; // "meteor-rpc/client" for code without React
import type { Server } from "./server"; // type-only: no server code reaches the client bundle

export const api = createClient<Server>();
```

Outside components: `await api.tasks.add({ listId, title })` returns the result or throws.
If the app's client is `createClient<Server>({ suspense: true })`, its `useQuery` suspends like
`useSuspenseQuery` (and takes the same options).

## 4. React

| Call | Suspends | Use it for |
| --- | --- | --- |
| `api.x.useSuspenseQuery(input?, options?)` | yes | Method result; `data` is always defined |
| `api.x.useQuery(input?, options?)` | no | Method result with your own `isPending` UI |
| `api.x.useMutation(options?)` | no | Writes: `mutate(input)`, `mutateAsync`, `isPending`, `error` |
| `api.x.usePublication(input?)` | yes | Live `{ data, collection }`; shared: `{ data: { key }, collections }` |

```tsx
// imports/ui/App.tsx
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { isValidationError } from "meteor-rpc/react";
import { type FormEvent, Suspense, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { api } from "/imports/api/client";

const queryClient = new QueryClient();

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary fallback={<p role="alert">Something went wrong.</p>}>
      <Suspense fallback={<p>Loading…</p>}>
        <Tasks listId="inbox" />
      </Suspense>
    </ErrorBoundary>
  </QueryClientProvider>
);

function Tasks({ listId }: { listId: string }) {
  const { data: tasks } = api.tasks.byList.usePublication({ listId }); // live, per input
  const { data: overview } = api.tasks.overview.usePublication(); // shared: one array per key
  const { data: stats } = api.tasks.stats.useSuspenseQuery({ listId }); // cached method result
  const queryClient = useQueryClient();
  const add = api.tasks.add.useMutation({
    // Refetch the method queries this changes. Publications update by themselves.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: api.tasks.stats.queryKey({ listId }) }),
  });
  const [title, setTitle] = useState("");
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ listId, title }, { onSuccess: () => setTitle("") });
  };
  const error = isValidationError(add.error) // details: [{ path: ["title"], message }]
    ? add.error.details.map((issue) => issue.message).join(", ")
    : add.error?.message;

  return (
    <form onSubmit={onSubmit}>
      <h2>{stats.open} open of {tasks.length} ({overview.lists.length} lists)</h2>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button type="submit" disabled={add.isPending}>Add</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
```

- `templates/App.tsx` adds `QueryErrorResetBoundary`, so a "Retry" button refetches.
- `api.x.queryKey()` (no input) matches every input. `api.x.queryOptions(input)` feeds
  `prefetchQuery`, `ensureQueryData` and `useQueries`.
- Same publication + same input = one shared subscription. Each input has its own client
  collection: read documents from `data`, or `collection.find(selector, options).fetch()`.

## 5. Checklist

- [ ] Builder calls are chained (builders are immutable). `createModule("ns")` ends with
      `.buildSubmodule()` and goes into `.addSubmodule()`. Only the root calls `.build()`, in a
      file that `server/main.ts` imports.
- [ ] `import type { Server }` on the client. A value import ships server code to the browser.
- [ ] One `createClient<Server>()` in the app, in `imports/api/client.ts`.
- [ ] TanStack Query 5 names: `isPending` (not `isLoading`), `mutate` on the `useMutation()` result.
- [ ] `useSuspenseQuery` and `usePublication` sit under `QueryClientProvider`, an error boundary
      and `<Suspense>`. `useQuery` doesn't suspend: handle `isPending` and `undefined` data.
- [ ] Middlewares and hooks destructure one object: `({ userId, parsed })`, not `(raw, parsed)`.
- [ ] Mutations invalidate the method queries they affect. Publications never need it.
- [ ] Publication documents come from `usePublication` or `api.x.collection(input)`, never from
      `new Mongo.Collection(...)` or `Tasks.find()` on the client.
- [ ] No `any`, `@ts-ignore` or casts around meteor-rpc types: the type error is a real mistake.

## 6. Verify

1. Type-check (`meteor npm run typecheck` or `npx tsc --noEmit`): no new errors.
2. Run `meteor`: startup errors name the cause. `Method 'x' not found` means `server/main.ts`
   doesn't import the root module, or the submodule wasn't added. Then load a page using it.
