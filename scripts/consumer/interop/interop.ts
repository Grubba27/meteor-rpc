// Real Meteor objects (typed by the app's provider) flowing into and out of meteor-rpc.
import { DDP } from "meteor/ddp";
import { Meteor } from "meteor/meteor";
import { createClient } from "meteor-rpc/client";
import { createModule, isMeteorError } from "meteor-rpc/server";
import { Messages } from "./db.js";
import { noInput, roomFilter } from "./schemas.js";
import type { Server } from "./server.js";

// A DDP connection to another server is accepted as `connection`.
export const remote = createClient<Server>({ connection: DDP.connect("https://example.com") });

// meteor-rpc's handle is usable where Meteor's is expected.
export const handle: Meteor.SubscriptionHandle = remote.chat.messages.subscribe({ roomId: "r1" });

export const interop = createModule()
  .addMethod("whoami", noInput, function () {
    if (!this.userId) throw new Meteor.Error("not-authorized");
    return this.userId;
  })
  .addPublication("fromCursor", roomFilter, async ({ roomId }) => Messages.find({ roomId }))
  .build();

export function rethrow(error: unknown): never {
  if (isMeteorError(error)) throw new Meteor.Error(error.error, error.reason);
  throw error;
}
