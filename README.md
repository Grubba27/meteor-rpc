# Meteor-RPC

## What is this package?

_Inspired on [zodern:relay](https://github.com/zodern/meteor-relay) and on [tRPC](https://trpc.io/)_

This package provides functions for building E2E type-safe RPCs.

## How to download it?

```bash
meteor npm i meteor-rpc @tanstack/react-query zod
```

install react query into your project, following their [quick start guide](https://tanstack.com/query/latest/docs/framework/react/quick-start)

## How to use it?

Firstly, you need to create a module, then you can add methods, publications, and subscriptions to it.

Then you need to build the module and use it in the client as a type.

### createModule

`subModule` without a namespace: `createModule()` is used to create the `main` server module, the one that will be exported to be used in the client.

`subModule` with a namespace: `createModule("namespace")` is used to create a submodule that will be added to the main module.

> Remember to use `build` at the end of module creation to ensure that the module is going to be created.

for example:

```typescript
// server/main.ts
import { createModule } from "meteor-rpc";
import { ChatCollection } from "/imports/api/chat";
import { z } from "zod";

const Chat = createModule("chat")
  .addMethod("createChat", z.void(), async () => {
    return ChatCollection.insertAsync({ createdAt: new Date(), messages: [] });
  })
  .buildSubmodule();

const server = createModule() // server has no namespace
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .addSubmodule(Chat)
  .build();

export type Server = typeof server;

// client.ts
import { createClient } from "meteor-rpc";

const api = createClient<Server>();
const bar: "bar" = await api.bar("some string");
//   ?^ 'bar'
const newChatId = await api.chat.createChat(); // with intellisense
```

### module.addMethod

`addMethod(name: string, schema: ZodSchema, handler: (args: ZodTypeInput<ZodSchema>) => T, config?: Config<ZodTypeInput<ZodSchema>, T>)`

This is the equivalent of `Meteor.methods` but with types and runtime validation.

```typescript
// server/main.ts
import { createModule } from "meteor-rpc";
import { z } from "zod";

const server = createModule();

server.addMethod("foo", z.string(), (arg) => "foo" as const);

server.build();

// is the same as

import { Meteor } from "meteor/meteor";
import { z } from "zod";

Meteor.methods({
  foo(arg: string) {
    z.string().parse(arg);
    return "foo";
  },
});
```

### module.addPublication

`addPublication(name: string, schema: ZodSchema, handler: (args: ZodTypeInput<ZodSchema>) => Cursor<any, any>)`

This is the equivalent of `Meteor.publish` but with types and runtime validation.

```typescript
// server/main.ts
import { createModule } from "meteor-rpc";
import { ChatCollection } from "/imports/api/chat";
import { z } from "zod";

const server = createModule();

server.addPublication("chatRooms", z.void(), () => {
  return ChatCollection.find();
});

server.build();

// is the same as
import { Meteor } from "meteor/meteor";
import { ChatCollection } from "/imports/api/chat";

Meteor.publish("chatRooms", function () {
  return ChatCollection.find();
});
```


### module.addSharedPublication

`addSharedPublication(name: string, schema: ZodSchema, handler: (args: ZodTypeInput<ZodSchema>) => Array<Mongo.Cursor<any>> | Promise<Array<Mongo.Cursor<any>>> )`

This is similar to `addPublication`, but it allows you to create an array of cursors, which can be useful for shared queries that need to return multiple collections or different queries.

```typescript
// server/main.ts
import { createModule } from "meteor-rpc";
import { ChatCollection } from "/imports/api/chat";
import { UserCollection } from "/imports/api/user";
import { z } from "zod";

const server = createModule();
server.addSharedPublication("chatRooms", z.string(), (userId) => {
  return [ChatCollection.find({ userId }), UserCollection.find({ userId })];
});

server.build();
// is the same as
import { Meteor } from "meteor/meteor";
import { ChatCollection } from "/imports/api/chat";
import { UserCollection } from "/imports/api/user";
import { check } from "meteor/check";

Meteor.publish("chatRooms", function (userId) {
  check(userId, String);
  return [ChatCollection.find({ userId }), UserCollection.find({ userId })];
});
```



### module.addSubmodule

This is used to add a submodule to the main module, adding namespaces for your methods and publications and also making it easier to organize your code.

> Remember to use `submodule.buildSubmodule` when creating a submodule

```typescript
// module/chat.ts
import { ChatCollection } from "/imports/api/chat";
import { createModule } from "meteor-rpc";

export const chatModule = createModule("chat")
  .addMethod("createChat", z.void(), async () => {
    return ChatCollection.insertAsync({ createdAt: new Date(), messages: [] });
  })
  .buildSubmodule(); // <-- this is important so that this module can be added as a submodule

// server/main.ts
import { createModule } from "meteor-rpc";
import { chatModule } from "./module/chat";

const server = createModule()
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .addSubmodule(chatModule)
  .build();

server.chat; // <-- this is the namespace for the chat module
```

### module.addMiddlewares

`addMiddlewares(middlewares: Middleware[])`

`Type Middleware = (raw: unknown, parsed: unknown) => void;`

This is used to add middlewares to the module, it can be used to add side effects logic to the methods and publications, ideal for logging, rate limiting, etc.

The middleware ordering is last in first out. Check the example below:

```typescript
// module/chat.ts
import { ChatCollection } from "/imports/api/chat";
import { createModule } from "meteor-rpc";

export const chatModule = createModule("chat")
  .addMiddlewares([
    (raw, parsed) => {
      console.log("run first");
    },
  ])
  .addMethod("createChat", z.void(), async () => {
    return ChatCollection.insertAsync({ createdAt: new Date(), messages: [] });
  })
  .buildSubmodule();

// server/main.ts
import { createModule } from "meteor-rpc";
import { chatModule } from "./module/chat";

const server = createModule()
  .addMiddlewares([
    (raw, parsed) => {
      console.log("run second");
    },
  ])
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .addSubmodule(chatModule)
  .build();
```

## React focused API

### Using in the client

When using in the client you _have_ to use the `createModule` and `build` methods to create a module that will be used in the client
and be sure that you are exporting the type of the module

_You should only create one client in your application_

You can have something like `api.ts` that will export the client and the type of the client

```typescript
// server/main.ts
import { createModule } from "meteor-rpc";

const server = createModule()
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .build();

export type Server = typeof server;

// client.ts
import type { Server } from "/imports/api/server"; // you must import the type
const app = createClient<Server>();

await app.bar("str"); // it will return "bar"
```

### method.useMutation

It uses the [`useMutation`](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation#usemutation) from react-query to create a mutation that will call the method

```tsx
// server/main.ts
import { createModule } from "meteor-rpc";

const server = createModule()
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .build();

export type Server = typeof server;

// client.ts
import type { Server } from "/imports/api/server"; // you must import the type
const app = createClient<Server>();

export const Component = () => {
  const { mutate, isLoading, isError, error, data } = app.bar.useMutation();

  return (
    <button
      onClick={() => {
        mutation.mutate("str"); // it has intellisense
      }}
    >
      Click me
    </button>
  );
};
```

### method.useQuery

It uses the [`useQuery`](https://tanstack.com/query/latest/docs/framework/react/reference/useSuspenseQuery#usesuspensequery) from react-query to create a query that will call the method, it uses `suspense` to handle loading states

```tsx
// server/main.ts
import { createModule } from "meteor-rpc";

const server = createModule()
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .build();

export type Server = typeof server;

// client.ts
import type { Server } from "/imports/api/server"; // you must import the type
const app = createClient<Server>();

export const Component = () => {
  const { data } = app.bar.useQuery("str"); // will trigger suspense

  return <div>{data}</div>;
};
```

### publication.useSubscription

Subscriptions on the client have `useSubscription` method that can be used as a hook to subscribe to a publication. It uses `suspense` to handle loading states

```tsx
// server/main.ts
import { createModule } from "meteor-rpc";
import { ChatCollection } from "/imports/api/chat";
import { z } from "zod";

const server = createModule()
  .addPublication("chatRooms", z.void(), () => {
    return ChatCollection.find();
  })
  .build();

export type Server = typeof server;

// client.ts
import type { Server } from "/imports/api/server"; // you must import the type
const app = createClient<Server>();

export const Component = () => {
  const { data: rooms, collection: chatCollection } =
    api.chatRooms.usePublication(); // it will trigger suspense and rooms is reactive

  return <div>{data}</div>;
};
```

## Examples

Currently we have this [chat-app](https://github.com/Grubba27/testing-meteor-rpc) that uses this package to create a chat app

it includes: methods, publications, and subscriptions

## Advanced usage

you can take advantage of the hooks to add custom logic to your methods, checking the raw and parsed data, and the result of the method,
you can add more complex validations.

```typescript
server.addMethod("name", z.any(), () => "str", {
  hooks: {
    onBeforeResolve: [
      (raw, parsed) => {
        console.log("before resolve", raw, parsed);
      },
    ],
    onAfterResolve: [
      (raw, parsed, result) => {
        console.log("after resolve", raw, parsed, result);
      },
    ],
    onErrorResolve: [
      (err, raw, parsed) => {
        console.log("error resolve", err, raw, parsed);
      },
    ],
  },
});
```

or

```ts
// server.ts
server.name.addBeforeResolveHook((raw, parsed) => {
  console.log("before resolve", raw, parsed);
});

server.name.addAfterResolveHook((raw, parsed, result) => {
  console.log("after resolve", raw, parsed, result);
});

server.name.addErrorResolveHook((err, raw, parsed) => {
  console.log("error resolve", err, raw, parsed);
});

server = server.build();
```
