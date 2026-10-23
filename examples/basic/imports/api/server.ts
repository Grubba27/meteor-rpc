// The whole API of the app. Import this file on the server only (server/main.ts does).
// The client imports its *type* only: `import type { Server } from "/imports/api/server"`.
import { Meteor } from "meteor/meteor";
import { Random } from "meteor/random";
import { createModule, isMeteorError, type Middleware } from "meteor-rpc/server";
import * as v from "valibot";
import { z } from "zod";
import { Members, Messages, Rooms } from "./collections";

/** Rejects every call from a connection that hasn't logged in. */
const requireUser: Middleware = ({ userId }) => {
  if (!userId) throw new Meteor.Error("not-authorized", "Log in first");
};

/** Only people who own at least one room can moderate. */
const requireRoomOwner: Middleware = async ({ userId }) => {
  if (!(await Rooms.findOneAsync({ ownerId: userId ?? "" }))) {
    throw new Meteor.Error("forbidden", "Only room owners can moderate");
  }
};

// auth.guest: a demo-only guest session. Real apps use accounts-password or another login.
const auth = createModule("auth")
  .addMethod("guest", z.void(), async function () {
    const userId = Random.id();
    await this.setUserId(userId); // `this` is Meteor's method invocation
    return userId;
  })
  .buildSubmodule();

// chat.moderation: nested submodule. Its DDP names are "chat.moderation.<name>",
// and it runs the chat middlewares first, then its own.
const moderation = createModule("moderation")
  .addMiddlewares([requireRoomOwner])
  .addMethod("deleteMessage", v.object({ messageId: v.string() }), async ({ messageId }, ctx) => {
    const message = await Messages.findOneAsync(messageId);
    const room = message && (await Rooms.findOneAsync(message.roomId));
    if (!message || room?.ownerId !== ctx.userId) {
      throw new Meteor.Error("not-found", "No such message in a room you own");
    }
    return Messages.removeAsync(messageId);
  })
  .buildSubmodule();

const chat = createModule("chat")
  .addMiddlewares([requireUser])
  .addMethod(
    "createRoom",
    // zod: the resolver gets the trimmed name.
    z.object({ name: z.string().trim().min(1).max(50) }),
    async ({ name }, { userId }) =>
      Rooms.insertAsync({ name, ownerId: userId!, createdAt: new Date() }),
  )
  .addMethod("join", z.string(), async (roomId, { userId }) => {
    if (!(await Rooms.findOneAsync(roomId))) {
      throw new Meteor.Error("not-found", "No such room");
    }
    await Members.upsertAsync(`${roomId}:${userId}`, {
      $setOnInsert: { roomId, userId: userId!, joinedAt: new Date() },
    });
    return true as const;
  })
  .addMethod(
    "send",
    // valibot works too: any Standard Schema does.
    v.object({
      roomId: v.string(),
      text: v.pipe(
        v.string(),
        v.trim(),
        v.minLength(1, "Message can't be empty"),
        v.maxLength(500),
      ),
    }),
    async ({ roomId, text }, { userId }) =>
      Messages.insertAsync({ roomId, text, userId: userId!, createdAt: new Date() }),
    {
      rateLimit: { limit: 5, interval: 1000 }, // per connection; needs `meteor add ddp-rate-limiter`
      hooks: {
        onAfterResolve: [
          async ({ parsed }) => {
            await Rooms.updateAsync(parsed.roomId, { $set: { lastMessageAt: new Date() } });
          },
        ],
        onErrorResolve: [
          ({ name, error }) => {
            // Expected errors are Meteor.Errors; anything else is a bug worth logging.
            if (!isMeteorError(error)) console.error(`${name} failed`, error);
          },
        ],
      },
    },
  )
  // The client calls it with { roomId } or { roomId, limit }; the resolver always gets a limit.
  .addPublication(
    "messages",
    z.object({ roomId: z.string(), limit: z.number().int().min(1).max(200).default(50) }),
    ({ roomId, limit }) => Messages.find({ roomId }, { sort: { createdAt: -1 }, limit }),
  )
  // One subscription, two client collections: data.room and data.members never mix.
  .addSharedPublication("room", z.string(), (roomId) => ({
    room: Rooms.find({ _id: roomId }),
    members: Members.find({ roomId }),
  }))
  .addSubmodule(moderation)
  .buildSubmodule();

export const server = createModule()
  .addMethod("ping", z.void(), () => "pong" as const)
  .addPublication("rooms", z.void(), () => Rooms.find({}, { sort: { createdAt: -1 } }))
  .addSubmodule(auth)
  .addSubmodule(chat)
  .build(); // registers every method and publication with Meteor

export type Server = typeof server;
