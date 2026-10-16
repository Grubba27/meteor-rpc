# meteor-rpc example: Meteor 3 + React

A small chat app that uses every part of meteor-rpc:

- `imports/api/server.ts`: the API. It has a root module, a `chat` submodule, a nested `chat.moderation` submodule, and an `auth` submodule. Methods use zod and valibot schemas. It also has a cursor publication (`chat.messages`), a shared publication (`chat.room`), middlewares, hooks and a `rateLimit`.
- `imports/api/client.ts`: `createClient<Server>()` from `meteor-rpc/react`. It imports the server's type only.
- `imports/ui/App.tsx`: `useSuspenseQuery`, `useMutation` and `usePublication`, inside `QueryClientProvider`, `Suspense` and an error boundary.
- `tests/`: the package's integration tests. They call the server over real DDP connections (`DDP.connect(Meteor.absoluteUrl())`).

In your own app, install the package from npm: `meteor npm install meteor-rpc @tanstack/react-query zod`.
This example instead installs a tarball packed from this repository, so it always runs the current source.

## Run it

From the repository root:

```bash
npm run test:meteor                            # build, pack, install, then run the tests headless
npm run test:meteor -- --release 3.6-beta.3    # also run them on another Meteor release
node scripts/meteor-test.mjs --setup-only      # build, pack, install only
cd examples/basic && meteor                    # then start the app at http://localhost:3000
```

Notes:
- `rateLimit` needs the `ddp-rate-limiter` package, which is already in `.meteor/packages`.
- Meteor's classic bundler compiles JSX with the classic runtime, so `.tsx` files `import React`.
- The guest login (`auth.guest`) calls `this.setUserId()`. It exists only to keep the demo small; use a real login in your app.
