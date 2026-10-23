# meteor-rpc

End-to-end type-safe methods and publications for [Meteor](https://www.meteor.com), with
[TanStack Query](https://tanstack.com/query) hooks for React.

Define your API once on the server with any [Standard Schema](https://standardschema.dev)
validator (zod, valibot, arktype, …). The client gets a fully typed object: autocomplete for every
method, inputs checked at compile time and validated at runtime, and results typed from what your
resolvers return. Inspired by [tRPC](https://trpc.io) and [zodern:relay](https://github.com/zodern/meteor-relay).

```ts
// server
const server = createModule()
  .addMethod("greet", z.object({ name: z.string() }), ({ name }) => `Hello, ${name}!`)
  .build();
export type Server = typeof server;

// client
const api = createClient<Server>();
const message = await api.greet({ name: "Ada" }); // string, autocompleted and type-checked
```

> Upgrading from 1.x? Read [MIGRATION.md](./MIGRATION.md). A codemod does most of the work.

## Install

```bash
meteor npm install meteor-rpc zod @tanstack/react-query
```

| Requirement | Version |
| --- | --- |
| Meteor | 3.0 or later |
| Validator | any Standard Schema: zod ≥ 3.24, valibot ≥ 1.0, arktype ≥ 2.0, … |
| React + @tanstack/react-query (optional, for the hooks) | React 18.2+ or 19, TanStack Query 5 |
| TypeScript (optional) | 5.0 or later. Works with `@types/meteor`, `zodern:types` and Meteor 3.6 native types. |

## Quickstart

### 1. Define the API on the server

```ts
// imports/api/server.ts
import { Meteor } from "meteor/meteor";
import { createModule } from "meteor-rpc";
import { z } from "zod";
import { Tasks } from "./tasks"; // a Mongo.Collection

const tasks = createModule("tasks")
  .addMiddlewares([
    ({ userId }) => {
      if (!userId) throw new Meteor.Error("not-authorized");
    },
  ])
  .addMethod("add", z.object({ title: z.string().min(1) }), async ({ title }, { userId }) => {
    return Tasks.insertAsync({ title, done: false, owner: userId });
  })
  .addMethod("toggle", z.object({ id: z.string(), done: z.boolean() }), ({ id, done }) =>
    Tasks.updateAsync(id, { $set: { done } }),
  )
  .addPublication("mine", z.void(), (_input, { userId }) => Tasks.find({ owner: userId }))
  .buildSubmodule();

const server = createModule()
  .addMethod("ping", z.void(), () => "pong" as const)
  .addSubmodule(tasks)
  .build(); // registers everything with Meteor

export type Server = typeof server;
```

```ts
// server/main.ts
import "/imports/api/server";
```

### 2. Create the client once

```ts
// imports/api/client.ts
import { createClient } from "meteor-rpc";
import type { Server } from "./server"; // type-only: no server code reaches the client

export const api = createClient<Server>();
```

### 3. Use it in React

```tsx
// imports/ui/App.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { api } from "/imports/api/client";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>Loading…</p>}>
        <Tasks />
      </Suspense>
    </QueryClientProvider>
  );
}

function Tasks() {
  const { data: tasks } = api.tasks.mine.usePublication(); // live data, suspends until ready
  const add = api.tasks.add.useMutation();
  const toggle = api.tasks.toggle.useMutation();

  return (
    <>
      <button type="button" onClick={() => add.mutate({ title: "New task" })} disabled={add.isPending}>
        Add
      </button>
      <ul>
        {tasks.map((task) => (
          <li key={task._id}>
            <input
              type="checkbox"
              checked={task.done}
              onChange={(event) => toggle.mutate({ id: task._id, done: event.target.checked })}
            />
            {task.title}
          </li>
        ))}
      </ul>
    </>
  );
}
```

Wrap the tree in an error boundary to show failures (for example `react-error-boundary`).
Suspense hooks throw errors to the nearest one.

A complete app lives in [`examples/basic`](./examples/basic).

## What you get

| On the server | On the client (`api.<path>`) |
| --- | --- |
| `addMethod(name, schema, resolver, config?)` | `api.x(input)`, `useQuery`, `useSuspenseQuery`, `useMutation`, `queryKey`, `queryOptions`, `mutationOptions` |
| `addPublication(name, schema, resolver, config?)` (one cursor) | `usePublication(input)` → `{ data, collection }`, `subscribe(input, callbacks)`, `collection(input)` |
| `addSharedPublication(name, schema, resolver, config?)` (named cursors) | `usePublication(input)` → `{ data: { key: [] }, collections }`, `subscribe`, `collections(input)` |
| `createModule("ns")…buildSubmodule()` + `addSubmodule` | `api.ns.x` |
| `addMiddlewares([fn])`, `config.hooks`, `config.rateLimit` | Errors as `Meteor.Error`; `isValidationError(error)` |
| `createCaller(module).x(input)`: call another module from server code | `createClient<Server>({ suspense: true })`: every `useQuery` suspends, so `data` is always defined |

## Documentation

- [Server: modules, methods, publications, middlewares, hooks, rate limits](./docs/server.md)
- [React: queries, mutations, publications](./docs/react.md)
- [Client without React: Blaze, Vue, scripts, other servers](./docs/client.md)
- [Errors and validation](./docs/errors.md)
- [TypeScript: type providers, Meteor 3.6 native types, inference](./docs/typescript.md)
- [Troubleshooting](./docs/troubleshooting.md)
- [Agent skill for writing meteor-rpc code](./skills/meteor-rpc/SKILL.md) (Claude Code, Codex, Cursor, …): `cp -r node_modules/meteor-rpc/skills/meteor-rpc .claude/skills/`
- [Migrating from 1.x](./MIGRATION.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)

## Entry points

| Import | Contains | Needs React |
| --- | --- | --- |
| `meteor-rpc` | everything below | yes |
| `meteor-rpc/server` | `createModule`, server types | no |
| `meteor-rpc/client` | `createClient` without hooks | no |
| `meteor-rpc/react` | `createClient` with hooks | yes |

## License

[MIT](./LICENSE)
