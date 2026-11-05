// Core client (no React): `meteor-rpc/client`.
import {
  type Client,
  type ClientCollection,
  createClient,
  isMeteorError,
  isValidationError,
  type SubscriptionHandle,
  type VALIDATION_ERROR,
  type ValidationIssue,
} from "meteor-rpc/client";
import type { Room } from "./db.js";
import { assert, type Equal } from "./expect.js";
import type { Member, Message, Server } from "./server.js";

export const api: Client<Server> = createClient<Server>();

export async function runCoreClient(): Promise<void> {
  const pong = await api.ping();
  assert<Equal<typeof pong, "pong">>();

  const sent = await api.chat.send({ roomId: "r1", text: "hello" });
  assert<Equal<typeof sent, { id: string; at: Date }>>();

  const doubled = await api.chat.length("abc");
  assert<Equal<typeof doubled, number>>();

  assert<Equal<Awaited<ReturnType<typeof api.page>>, number>>();
  await api.page();
  await api.page({ page: 2 });

  const deep = await api.outer.inner.deep();
  assert<Equal<typeof deep, "deep">>();

  const handle: SubscriptionHandle = api.chat.messages.subscribe(
    { roomId: "r1" },
    {
      onReady: () => {},
      onStop: (error) => {
        if (isValidationError(error)) {
          assert<Equal<typeof error.error, typeof VALIDATION_ERROR>>();
          const first = error.details.at(0);
          assert<Equal<typeof first, ValidationIssue | undefined>>();
        }
      },
    },
  );
  assert<Equal<ReturnType<typeof handle.ready>, boolean>>();
  handle.stop();

  const messages = api.chat.messages.collection({ roomId: "r1" });
  assert<Equal<typeof messages, ClientCollection<Message>>>();
  const latest = messages.find({ roomId: "r1" }, { sort: { _id: -1 }, limit: 10 }).fetch();
  assert<Equal<typeof latest, Message[]>>();
  const texts = messages.find().map((message) => message.text);
  assert<Equal<typeof texts, string[]>>();

  api.chat.room.subscribe("r1");
  const member = api.chat.room.collections("r1").members.findOne();
  assert<Equal<typeof member, Member | undefined>>();
  const room = await api.chat.room.collections("r1").room.findOneAsync("r1");
  assert<Equal<typeof room, Room | undefined>>();

  // A publication that only ever returns null publishes no documents.
  api.chat.nothing.subscribe();
  api.chat.nothing.subscribe({ onReady: () => {} });
  assert<Equal<ReturnType<typeof api.chat.nothing.collection>, ClientCollection<never>>>();

  try {
    await api.chat.send({ roomId: "r1", text: "" });
  } catch (error) {
    if (isMeteorError(error)) {
      assert<Equal<typeof error.error, string | number>>();
      assert<Equal<typeof error.reason, string | undefined>>();
    }
  }
}

export async function clientMisuse(): Promise<void> {
  // @ts-expect-error roomId must be a string
  await api.chat.send({ roomId: 1, text: "x" });
  // @ts-expect-error input is required
  await api.chat.send();
  // @ts-expect-error the transform's input is a string, not its output
  await api.chat.length(3);
  // @ts-expect-error unknown procedure
  await api.chat.missing();
  // @ts-expect-error unknown key of a shared publication
  api.chat.room.collections("r1").nope;
  // @ts-expect-error a shared publication's collections need its input
  api.chat.room.collections();
  // @ts-expect-error methods have no subscribe()
  api.ping.subscribe();
  // @ts-expect-error void input takes no argument
  await api.ping("extra");
}
