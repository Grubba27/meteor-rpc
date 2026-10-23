// A feature module. Copy to imports/api/tasks.ts and add it to the root module (server.ts).
// Server only: the client never imports this file, only the `Server` type.
import { Meteor } from "meteor/meteor";
import { createModule, isMeteorError, type Middleware } from "meteor-rpc/server";
import { z } from "zod";
import { Lists, Tasks } from "./collections";

/** Rejects method calls and subscriptions from logged-out connections. */
const requireUser: Middleware = ({ userId }) => {
  if (!userId) throw new Meteor.Error("not-authorized", "Log in first");
};

export const tasks = createModule("tasks") // DDP names: "tasks.add", "tasks.byList", …
  .addMiddlewares([requireUser]) // runs before every method AND publication below
  .addMethod(
    "add",
    z.object({ listId: z.string(), title: z.string().trim().min(1, "Title is required") }),
    // `userId!`: requireUser already rejected logged-out calls.
    (input, { userId }) =>
      Tasks.insertAsync({ ...input, done: false, ownerId: userId!, createdAt: new Date() }),
    {
      rateLimit: { limit: 5, interval: 1000 }, // per connection; needs `meteor add ddp-rate-limiter`
    },
  )
  .addMethod(
    "setDone",
    z.object({ id: z.string(), done: z.boolean() }),
    async ({ id, done }, { userId }) => {
      const updated = await Tasks.updateAsync({ _id: id, ownerId: userId! }, { $set: { done } });
      // Only Meteor.Error reaches the client intact; other errors become "Internal server error".
      if (updated === 0) throw new Meteor.Error("not-found", "No such task");
      return done;
    },
    {
      hooks: {
        // Hooks, like middlewares, receive ONE context object.
        onErrorResolve: [
          ({ name, error }) => {
            if (!isMeteorError(error)) console.error(`${name} failed`, error);
          },
        ],
      },
    },
  )
  .addMethod("stats", z.object({ listId: z.string() }), async ({ listId }, { userId }) => ({
    open: await Tasks.find({ listId, ownerId: userId!, done: false }).countAsync(),
    done: await Tasks.find({ listId, ownerId: userId!, done: true }).countAsync(),
  }))
  // One cursor. The client may omit `limit`; the resolver always gets a number.
  .addPublication(
    "byList",
    z.object({ listId: z.string(), limit: z.number().int().max(200).default(50) }),
    ({ listId, limit }, { userId }) =>
      Tasks.find({ listId, ownerId: userId! }, { sort: { createdAt: -1 }, limit }),
  )
  // Several cursors in one subscription: one client collection per key.
  .addSharedPublication("overview", z.void(), (_input, { userId }) => ({
    lists: Lists.find({ ownerId: userId! }, { sort: { name: 1 } }),
    recent: Tasks.find({ ownerId: userId! }, { sort: { createdAt: -1 }, limit: 5 }),
  }))
  .buildSubmodule(); // namespaced modules end with buildSubmodule(), never build()
