// The API behind `api` in the documentation's fragments: every path the docs call.
import { Meteor } from "meteor/meteor";
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import { Messages, Rooms, Tasks } from "./collections";

const tasks = createModule("tasks")
  .addMethod("add", z.object({ title: z.string().min(1) }), ({ title }, { userId }) =>
    Tasks.insertAsync({ title, done: false, owner: userId }),
  )
  .addMethod("toggle", z.object({ id: z.string(), done: z.boolean() }), ({ id, done }) =>
    Tasks.updateAsync(id, { $set: { done } }),
  )
  .addPublication("mine", z.void(), (_input, { userId }) => Tasks.find({ owner: userId }))
  .buildSubmodule();

const users = createModule("users")
  .addMethod("get", z.object({ id: z.string() }), async ({ id }) => {
    const user = await Meteor.users.findOneAsync(id);
    if (!user) throw new Meteor.Error("not-found");
    return { _id: user._id, name: user.username ?? "" };
  })
  .addMethod("stats", z.object({ id: z.string() }), async () => ({ posts: 0 }))
  .addMethod("rename", z.object({ id: z.string(), name: z.string().min(1) }), async () => {})
  .addMethod(
    "signup",
    z.object({ email: z.email(), password: z.string().min(8) }),
    async () => "userId",
  )
  .buildSubmodule();

const chat = createModule("chat")
  .addPublication("messages", z.object({ roomId: z.string() }), ({ roomId }) =>
    Messages.find({ roomId }),
  )
  .addSharedPublication("room", z.string(), (roomId) => ({
    room: Rooms.find({ _id: roomId }),
    messages: Messages.find({ roomId }),
  }))
  .buildSubmodule();

export const server = createModule()
  .addMethod("ping", z.void(), () => "pong" as const)
  .addSubmodule(tasks)
  .addSubmodule(users)
  .addSubmodule(chat)
  .build();

export type Server = typeof server;
