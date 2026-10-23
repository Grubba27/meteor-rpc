# TypeScript

## Setup

You don't need any special configuration:

- meteor-rpc ships compiled JavaScript and `.d.ts` files.
- Its types don't import anything from `meteor/*`.
- It type-checks the same way whichever Meteor type provider your app uses:

| Provider | Notes |
| --- | --- |
| `@types/meteor` | Default in Meteor's TypeScript skeleton. |
| `zodern:types` | Generated into `.meteor/local/types`. |
| Meteor 3.6 native types | `meteor types` plus the tsconfig from the [Meteor guide](https://github.com/meteor/meteor/blob/release-3.6/v3-docs/docs/cli/using-core-types.md). |
| none | meteor-rpc's own types still work. |

On TypeScript 7, remove `"baseUrl"` from the tsconfig the Meteor 3.6 guide suggests: TS 7
removed that option (error TS5102), and the `paths` work without it.

Every change is checked ([`scripts/consumer-check.mjs`](../scripts/consumer-check.mjs)) with TypeScript 5.9 and 7.0, including `strict`, `exactOptionalPropertyTypes`,
`noUncheckedIndexedAccess`, `verbatimModuleSyntax` and `skipLibCheck: false`, and with
`moduleResolution` set to `bundler`, `node16` or `node10`.

## How the client is typed

`build()` returns a description of your API, and `typeof server` carries every method's input and
result types:

```ts
export type Server = typeof server;
const api = createClient<Server>(); // Client<Server> / ReactClient<Server>
```

- **Input.** What the schema accepts, i.e. Standard Schema's `InferInput`.
- **Result.** The resolver's awaited return type.
- **Publication documents.** Inferred from the cursor's `fetch()` type.

Keep `import type`, so the server module (and its dependencies) never reaches the client bundle.

## Useful types

From `meteor-rpc/server`:

- **Definitions:** `MethodDefinition`, `PublicationDefinition`, `Router`, `Submodule`, `ModuleBuilder`.
- **Server-side calls:** `Caller` (what `createCaller` returns).
- **Contexts:** `MethodContext`, `PublicationContext`, `MiddlewareContext`, `Middleware`, `Hooks`.
- **Meteor objects:** `MethodInvocation`, `Subscription`, `ConnectionInfo`.
- **Schemas:** `InferInput`, `InferOutput`, `StandardSchemaV1`.

From `meteor-rpc/client` and `meteor-rpc/react`:

- `Client`, `ReactClient`, `MethodCaller`, `ClientCollection`, `ValidationIssue`, `MethodQueryKey`, `QueryData`.
- With `{ suspense: true }`: `SuspenseReactClient`, `SuspenseReactMethodClient`. The options type is `ReactClientOptions`. Pass `suspense` as a literal `true` or `false` to get one client type; a `boolean` gives the union of both.

Annotating a client explicitly:

```ts
import type { ReactClient } from "meteor-rpc/react";
export const api: ReactClient<Server> = createClient<Server>();
```

## Large APIs

The server type grows with every `add*` call. For very large APIs, split them into submodules in
separate files. Each `buildSubmodule()` result is a value with its own type, which keeps errors
readable and type-checking fast.

## Mistakes caught at compile time

- Wrong or missing input: `api.users.get()` when the schema needs `{ id }`.
- Unknown methods and publications.
- `build()` on a namespaced module, and `buildSubmodule()` on the root.
- Duplicate, dotted or reserved names (`subscribe`, `useSomething`, `$something`, …).
- Publication resolvers that don't return a cursor (or a record of cursors).
