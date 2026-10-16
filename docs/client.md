# Client without React

`meteor-rpc/client` has the typed client without any React code. Use it with Blaze, Vue,
Svelte, in scripts, on the server, or against another Meteor server.

```ts
import { createClient } from "meteor-rpc/client";
import type { Server } from "/imports/api/server";

const api = createClient<Server>();
```

## Methods

```ts
const id = await api.tasks.add({ title: "Write docs" }); // Promise of the resolver's result
await api.ping();                                         // no input
```

Errors reject the promise; see [Errors](./errors.md).

## Publications

```ts
const handle = api.chat.messages.subscribe(
  { roomId },
  {
    onReady: () => console.log("ready"),
    onStop: (error) => error && console.error(error),
  },
);

Tracker.autorun(() => {
  if (!handle.ready()) return;
  const messages = api.chat.messages.collection({ roomId }).find({}, { sort: { createdAt: 1 } }).fetch();
  render(messages);
});

handle.stop();
```

- `subscribe(input, callbacks?)` returns Meteor's subscription handle (`ready()`, `stop()`).
  Publications without input also accept `subscribe()` or `subscribe(callbacks)`.
- `collection(input)` returns the client collection holding the documents published for that
  input. Each input has its own, so two subscriptions never see each other's documents.
- For shared publications, `collections(input)` returns the collections by key:
  `api.chat.room.collections(roomId).messages`.
- Reads are reactive inside `Tracker.autorun`, `useTracker`, Blaze helpers, and the like.

The collection is a real `Mongo.Collection`, typed with the subset of methods reads need
(`find`, `findOne`, `findOneAsync`). Cast it if you need more.

## Calling methods from the server

On the server, `createClient` calls methods in-process through `Meteor.callAsync`, so they still
get validation, middlewares and hooks:

```ts
import { createClient } from "meteor-rpc/client";
import type { Server } from "/imports/api/server";

const api = createClient<Server>();
await api.tasks.add({ title: "Created by a cron job" });
```

Subscriptions need a client connection. On the server with the default connection, `subscribe`,
`collection` and `collections` throw.

## Another Meteor server

Pass any DDP connection:

```ts
import { DDP } from "meteor/ddp";
import type { Server as BillingServer } from "@acme/billing-api"; // the other app's exported type

const billing = createClient<BillingServer>({ connection: DDP.connect("https://billing.example.com") });
await billing.invoices.list();
billing.invoices.updates.subscribe(); // documents go to collections on that connection
```

This also works on the server, which makes it handy for integration tests:

```ts
const api = createClient<Server>({ connection: DDP.connect(Meteor.absoluteUrl()) });
```

On the server, Meteor fills a newly created client collection asynchronously.
- **Cursor publications:** `subscribe` creates the collection before subscribing.
- **Shared publications:** read `collections(input).key` once before subscribing, so its
  documents are there when `onReady` runs.
