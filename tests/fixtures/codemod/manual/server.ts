// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { Meteor } from "meteor/meteor";
import { createMethod, createModule, createSafeCaller, type ReturnMethod } from "meteor-rpc";
import { z } from "zod";
import { Messages, Rooms, Users } from "./collections";

export const double = createMethod("double", z.number(), (n) => n * 2).expect<number>();
double.addBeforeResolveHook((raw, parsed) => console.log(raw, parsed));
double.setResolver((n) => n * 3);
export type Double = ReturnMethod<"double", z.ZodNumber, number>;

const chat = createModule("chat").addMethod("send", z.string(), (text) => text);
export const chatRouter = chat.build();

const rooms = createModule("rooms")
  .addSharedPublication("room", z.string(), (roomId) => [
    Rooms.find({ _id: roomId }),
    Messages.find({ roomId }),
  ])
  .addSharedPublication("lobby", z.void(), function () {
    if (!this.userId) return null;
    return [Rooms.find(), Users.find()];
  })
  .addSharedPublication("migrated", z.void(), () => ({ rooms: Rooms.find() }))
  .buildSubmodule();

export const server = createModule().addSubmodule(rooms).build();

export async function callDouble(): Promise<number> {
  const result = await Meteor.callAsync("double", 1);
  if (result?.__isError__) throw new Meteor.Error(result.error, result.reason);
  return createSafeCaller().call("double", 1);
}
