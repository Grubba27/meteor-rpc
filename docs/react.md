# React

`createClient` from `meteor-rpc` or `meteor-rpc/react` adds TanStack Query and publication hooks
to every method and publication.

```ts
// imports/api/client.ts — create it once
import { createClient } from "meteor-rpc/react";
import type { Server } from "./server";

export const api = createClient<Server>();
```

You need, above the components that use the hooks:

- a [`QueryClientProvider`](https://tanstack.com/query/latest/docs/framework/react/reference/QueryClientProvider)
- a `<Suspense>` boundary, for `useSuspenseQuery` and `usePublication`
- an error boundary, to show failures from suspense hooks

## Methods

| Hook | Wraps | Suspends |
| --- | --- | --- |
| `api.x.useQuery(input?, options?)` | [`useQuery`](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery) | no |
| `api.x.useSuspenseQuery(input?, options?)` | [`useSuspenseQuery`](https://tanstack.com/query/latest/docs/framework/react/reference/useSuspenseQuery) | yes |
| `api.x.useMutation(options?)` | [`useMutation`](https://tanstack.com/query/latest/docs/framework/react/reference/useMutation) | no |

`options` are TanStack Query's options without `queryKey`, `queryFn` and `mutationFn`. meteor-rpc
fills those in.

```tsx
function Profile({ id }: { id: string }) {
  const { data: user } = api.users.get.useSuspenseQuery({ id });
  const { data: stats, isPending } = api.users.stats.useQuery({ id }, { staleTime: 60_000 });
  const rename = api.users.rename.useMutation({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: api.users.get.queryKey({ id }) }),
  });

  return (
    <form onSubmit={(event) => { event.preventDefault(); rename.mutate({ id, name: "Ada" }); }}>
      <h1>{user.name}</h1>
      <p>{isPending ? "…" : `${stats?.posts} posts`}</p>
      <button disabled={rename.isPending}>Rename</button>
    </form>
  );
}
```

Methods without input are called with `mutate()` and `useQuery()`.

### Suspense by default

Create the client with `{ suspense: true }` to make every `useQuery` suspend, as
`useSuspenseQuery` does. `data` is then always defined, and loading and errors go to the nearest
`<Suspense>` and error boundary:

```tsx
import { createClient } from "meteor-rpc/react";
import type { Server } from "/imports/api/server";

export const api = createClient<Server>({ suspense: true });

function UserName({ id }: { id: string }) {
  const { data: user } = api.users.get.useQuery({ id }); // suspends; `user` is never undefined
  return <span>{user.name}</span>;
}
```

`useQuery` then takes `useSuspenseQuery`'s options (no `enabled`, for example). For a query that
shouldn't suspend, use TanStack Query's `useQuery` with `api.x.queryOptions(input)`.

### Query keys and options

- **`api.x.queryKey(input?)`** returns the key the hooks use: `["users.get", input]`. Without
  input (`["users.get"]`) it matches every input, which is handy for
  `queryClient.invalidateQueries`.
- **`api.x.queryOptions(input?, options?)`** returns `{ queryKey, queryFn, ...options }` for any
  TanStack Query API: `useQuery`, `useQueries`, `queryClient.prefetchQuery`, `ensureQueryData`, ….
- **`api.x.mutationOptions(options?)`** returns `{ mutationKey, mutationFn, ...options }`.

```tsx
// prefetch on hover
<a href={`/users/${id}`} onMouseEnter={() => queryClient.prefetchQuery(api.users.get.queryOptions({ id }))}>
  Profile
</a>
```

## Publications

```tsx
function Messages({ roomId }: { roomId: string }) {
  const { data: messages } = api.chat.messages.usePublication({ roomId });
  return <ul>{messages.map((m) => <li key={m._id}>{m.text}</li>)}</ul>;
}
```

- **Lifecycle.** `usePublication(input?)` subscribes, suspends until the subscription is ready,
  and re-renders as documents change.
- **Sharing.** Components using the same publication with the same input share one subscription.
  It stops shortly after the last of them unmounts. Different inputs get separate data, even
  while they're on screen at the same time.
- **Input.** The input is compared by value (EJSON), so passing a new object on every render is
  fine.
- **Return value for `addPublication`:** `{ data, collection }`.
  - `data` holds the documents.
  - `collection` is the client collection, for filtering or sorting:
    `collection.find({ unread: true }, { sort: { createdAt: 1 } })`.
- **Return value for `addSharedPublication`:** `{ data, collections }`, both keyed like the
  resolver's return value:

```tsx
const { data } = api.chat.room.usePublication(roomId);
data.room;     // Room[]
data.messages; // Message[]
```

- **Errors.** A subscription error (validation, a middleware throwing, the publication failing)
  is thrown to the nearest error boundary. When the boundary resets, the subscription is retried.
- **SSR.** Publication data isn't loaded during server-side rendering; `data` is empty there.

## Without suspense

For methods, use `useQuery` (it never suspends). For publications, call
`api.x.subscribe(input, callbacks)` and read `api.x.collection(input)` inside your own reactive hook
(for example `useTracker` from `react-meteor-data`). See [Client](./client.md).
