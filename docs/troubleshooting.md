# Troubleshooting

### "Invalid hook call" or "No QueryClient set, use QueryClientProvider"

- **Two copies of React or TanStack Query.** Run `meteor npm ls react @tanstack/react-query` and
  dedupe them. meteor-rpc only uses your copies, through peer dependencies.
- **No provider.** The component isn't inside a `QueryClientProvider`.

### A component stays on the Suspense fallback

`useSuspenseQuery` and `usePublication` suspend until the data is there. Check the browser
console and the server log for:

- an error thrown by a middleware or the resolver;
- a publication that never returns.

Add an error boundary so failures are shown instead of hidden.

### `Method 'x' not found` / `Subscription 'x' not found`

- The file that calls `build()` must be imported on the server (for example from `server/main.ts`).
- Submodules must be added to the root module with `addSubmodule` before `build()`.

### `module "x" is a submodule: call buildSubmodule()`

Only the root `createModule()` (no namespace) is built with `build()`. See [Server › Modules](./server.md#modules).

### `the schema of "x" is not a Standard Schema`

Upgrade your validator: zod to 3.24 or later, valibot to 1.0 or later, arktype to 2.0 or later.

### Subscriptions become ready but `data` stays empty

Two copies of meteor-rpc may be loaded. For example, under Rspack your app `import`s the ES module
build while a CommonJS dependency `require`s the CommonJS one. Meteor gives a collection name to
the first copy that registers it, so the other copy never receives documents. Make every import
go through one build: `meteor npm ls meteor-rpc` should show a single version, and dependencies
shouldn't bundle their own copy.

### `meteor-rpc: Meteor from the "meteor" Meteor package is not available` in unit tests

meteor-rpc never imports `meteor/*`: it reads Meteor from the `Package` global that Meteor fills
at runtime. So mocks of `meteor/meteor` (`vi.mock`, module aliases) don't reach it. Creating a
client works without Meteor, but calling a method needs it. Point the global at your stub in the
test setup file:

```ts
// vitest.setup.ts
import { Meteor } from "meteor/meteor"; // your stub, e.g. through a vitest alias

Object.assign(globalThis, { Package: { meteor: { Meteor } } });
```

Tests that replace `Meteor.callAsync` on that stub then receive the calls.

### `` `rateLimit` needs the ddp-rate-limiter package ``

Run `meteor add ddp-rate-limiter`.

### TypeScript errors inside `node_modules/meteor-rpc`

meteor-rpc 2 ships `.d.ts` files only, so this means an old 1.x copy is still installed. Delete
`node_modules`, reinstall, and check `meteor npm ls meteor-rpc`.

### Validation fails for `z.void()` methods when calling with no arguments

This was a 1.x bug, where calling without input sent `null`. Upgrade to 2.x.
