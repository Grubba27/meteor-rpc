# Server

Everything on this page comes from `meteor-rpc/server` (also re-exported by `meteor-rpc`).

- [Modules](#modules)
- [Methods](#methods)
- [Publications](#publications)
- [Shared publications](#shared-publications)
- [Middlewares](#middlewares)
- [Hooks](#hooks)
- [Rate limits](#rate-limits)
- [Names](#names)
- [Calling other modules from the server](#calling-other-modules-from-the-server)
- [How a call runs](#how-a-call-runs)

## Modules

A module collects methods and publications. Builders are immutable: every `add*` call returns a
new builder. Nothing is registered with Meteor until `build()`.

```ts
import { createModule } from "meteor-rpc/server";
import { z } from "zod";

const chat = createModule("chat") // a namespaced submodule
  .addMethod("send", z.string(), (text) => `You said: ${text}`)
  .buildSubmodule();

const server = createModule() // the root module: no namespace
  .addSubmodule(chat)
  .build(); // registers chat.* with Meteor, on the server only

export type Server = typeof server; // the client is typed from this
```

- `build()` is only for the root module. It registers every definition under its full dotted
  name (`chat.send`, `chat.rooms.list`, …). It returns the same router if called again, and
  registers nothing on the client.
- `buildSubmodule()` is only for namespaced modules, and registers nothing.
- Submodules nest as deep as you like: `createModule("a").addSubmodule(b)` gives `a.b.*`.

Import the file that calls `build()` from your server entry (`server/main.ts`). The client only
imports its **type**.

## Methods

```ts
.addMethod(name, schema, resolver, config?)
```

```ts
const server = createModule()
  .addMethod("rename", z.object({ id: z.string(), name: z.string().trim().min(1) }), async function (input, context) {
    // input: the schema's output (after transforms), here { id: string; name: string }
    // this: Meteor's method invocation (this.userId, this.connection, this.unblock(), …)
    // context: { type: "method", name: "rename", userId, connection, invocation }
    await Rooms.updateAsync(input.id, { $set: { name: input.name } });
    return { ok: true as const };
  })
  .build();
```

- **Schema.** Any [Standard Schema](https://standardschema.dev): zod ≥ 3.24, valibot ≥ 1.0,
  arktype ≥ 2.0, and others.
  - Use `z.void()` (or `v.void()`, …) for methods without input. The client then calls `api.x()`.
  - Schemas that accept `undefined` make the input optional on the client.
  - Async refinements are awaited.
- **Input and output types.** The client sends the schema's **input** type. The resolver receives
  its **output** type: `z.string().transform(Number)` is called with a string and resolves with a
  number.
- **Result.** The resolver may be async. The client receives the awaited return type, serialized
  with EJSON (Dates, binary and custom EJSON types survive the trip).

## Publications

```ts
.addPublication(name, schema, resolver, config?)
```

The resolver returns one Mongo cursor, or nothing:

```ts
.addPublication("messages", z.object({ roomId: z.string() }), function ({ roomId }, { userId }) {
  if (!userId) return; // ready, with no documents
  return Messages.find({ roomId }, { sort: { createdAt: -1 }, limit: 50 });
})
```

- **Separate client collection per input.** On the client, the documents of each (publication,
  input) pair land in a collection of their own, so they never mix:
  - not with other publications of the same Mongo collection;
  - not with the same publication subscribed with a different input.

  Read it with `usePublication(input)` or `collection(input)`; see [React](./react.md) and
  [Client](./client.md).
- **Ready after data.** The subscription becomes ready after the initial documents were sent.
- **Low-level publish API.** `this` is Meteor's `Subscription`, so `this.added()` etc. work, but
  documents you add yourself go to the collection you name, not to meteor-rpc's.

## Shared publications

```ts
.addSharedPublication(name, schema, resolver, config?)
```

When one subscription needs several collections, return an object of named cursors:

```ts
.addSharedPublication("room", z.string(), (roomId) => ({
  room: Rooms.find({ _id: roomId }),
  messages: Messages.find({ roomId }),
  members: Meteor.users.find({ roomIds: roomId }, { fields: { profile: 1 } }),
}))
```

- **Keys are separate.** Each key gets its own client collection, so documents with the same `_id`
  in different collections never overwrite each other.
- **Typed per key.** On the client, `usePublication` returns `{ data: { room, messages, members } }`
  with each key typed from its cursor, and `collections(input)` returns the collections by key.
- **Skipping keys.** A key can be `null` or `undefined` to publish nothing for it, and the
  resolver can return nothing at all.

## Middlewares

```ts
.addMiddlewares([fn, …])
```

Middlewares run for every method **and publication** of the module and all its submodules:

```ts
import type { Middleware } from "meteor-rpc/server";

const requireUser: Middleware = ({ userId }) => {
  if (!userId) throw new Meteor.Error("not-authorized");
};

const audit: Middleware = async ({ type, name, userId, parsed }) => {
  await AuditLog.insertAsync({ type, name, userId, input: parsed, at: new Date() });
};

const admin = createModule("admin").addMiddlewares([requireAdmin]) /* … */.buildSubmodule();

createModule()
  .addMiddlewares([requireUser, audit]) // root: runs first, for everything
  .addSubmodule(admin) // admin.* runs requireUser, audit, then requireAdmin
  .build();
```

- **When.** Middlewares run after input validation and before hooks and the resolver.
- **Order.** Outer module first, then in the order you added them.
- **Rejecting.** Throw to reject the call. The caller gets the error (use `Meteor.Error` to send
  a meaningful one).
- **Context.** A middleware receives:
  - `type`: `"method"` or `"publication"`
  - `name`
  - `userId`
  - `connection`
  - `raw` (input as sent) and `parsed` (after validation)
  - `invocation` (methods) or `subscription` (publications)

## Hooks

```ts
.addMethod("save", schema, save, {
  hooks: {
    onBeforeResolve: [({ parsed, userId }) => {}],   // after middlewares, before the resolver
    onAfterResolve: [({ parsed, result }) => {}],    // after the resolver succeeded
    onErrorResolve: [({ error, raw, parsed }) => {}], // when anything failed; `parsed` is undefined if validation failed
  },
})
```

- **Timing.** Hooks run in order and may be async; each is awaited.
- **Errors.** Throwing in `onBeforeResolve` or `onAfterResolve` fails the call. After the
  `onErrorResolve` hooks run, the original error is re-thrown to the caller. Errors thrown by an
  error hook are logged and don't replace it.
- **Typing.** Hook arguments are typed from the schema output and the resolver result.
- **Publications.** Hooks work the same way there; `result` is the cursor (or record of cursors).

## Rate limits

```ts
.addMethod("sendCode", schema, sendCode, { rateLimit: { limit: 3, interval: 60_000 } })
```

- **Scope.** At most `limit` calls per `interval` milliseconds, per connection (client address +
  connection + user). Works for methods and publications.
- **Package.** Needs Meteor's rate limiter in the app: `meteor add ddp-rate-limiter`. meteor-rpc
  throws a clear error at `build()` if it's missing.

## Names

- **Composition.** Method, publication and submodule names are joined with dots, so they can't
  contain dots themselves.
- **Reserved names.** These are reserved for client helpers:
  - `subscribe`, `collection`, `collections`, `queryKey`, `queryOptions`, `mutationOptions`
  - JavaScript's `then`, `catch`, `finally`, `toJSON`, `toString`, `valueOf`, `prototype`, `constructor`
  - any name starting with `use` followed by an uppercase letter (`useAnything`)
  - any name starting with `$`
- **Unique per module.** A name can be used once per module, across methods, publications and
  submodules.
- **Checked twice.** TypeScript reports these mistakes as you type, and `addMethod` & co. throw at
  runtime.

## Calling other modules from the server

To call a method of another module from server code, for example from a resolver, use
`createCaller`:

```ts
import { Meteor } from "meteor/meteor";
import { createCaller, createModule } from "meteor-rpc/server";
import { z } from "zod";
import { Tasks } from "/imports/api/tasks";

export const users = createModule("users")
  .addMethod("isAdmin", z.object({ id: z.string() }), async ({ id }) => id === "admin")
  .buildSubmodule();

export const tasks = createModule("tasks")
  .addMethod("clear", z.void(), async (_input, { userId }) => {
    const isAdmin = await createCaller(users).isAdmin({ id: userId ?? "" });
    if (!isAdmin) throw new Meteor.Error("not-authorized");
    return Tasks.removeAsync({});
  })
  .buildSubmodule();
```

- **Same pipeline.** Calls go through `Meteor.callAsync`, so they're validated and run the
  middlewares and hooks. Inside a method, they run with that method's `userId`.
- **Any module.** Pass a `buildSubmodule()` result or the root router from `build()`. A caller
  only has methods: subscribing needs a client connection.
- **Full names.** A submodule learns its full name (`chat.messages.send`) when the root module is
  built, so the name is resolved on each call. You can create the caller at import time.
- **Not `createClient<Server>()`.** Inside a module that is part of `Server`, typing a client with
  `Server` makes `Server` refer to itself (TS2456). `createCaller` is typed from the module you
  pass.

## How a call runs

Every method call and subscription goes through the same steps:

1. **Validate** the input with the schema. More than one argument, or invalid input, throws
   `Meteor.Error("validation-error")` with the issues ([Errors](./errors.md)).
2. **Middlewares**: outer module first.
3. **`onBeforeResolve`** hooks.
4. **Resolver.**
   - For publications, the cursors are then observed and published, and the subscription is
     marked ready.
5. **`onAfterResolve`** hooks.

If any step throws, the `onErrorResolve` hooks run and the error is re-thrown to the caller.
