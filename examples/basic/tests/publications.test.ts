import { strict as assert } from "node:assert";
import { type Client, createClient, isMeteorError, isValidationError } from "meteor-rpc/client";
import { Members, Messages, Rooms } from "/imports/api/collections";
import type { Server } from "/imports/api/server";
import {
  type Connection,
  disconnectAll,
  instanceOf,
  metaDoc,
  nameOf,
  newClient,
  ready,
  rejection,
  resetDb,
  waitFor,
} from "./helpers";
import type { ProbeServer } from "./probe-module";

describe("publications", () => {
  let connection: Connection;
  let api: Client<Server>;
  let probe: Client<ProbeServer>["probe"];

  beforeEach(async () => {
    await resetDb();
    ({ connection, api } = await newClient<Server>());
    probe = createClient<ProbeServer>({ connection }).probe;
  });

  afterEach(disconnectAll);

  async function loginWithRoom(name = "Lobby") {
    const userId = await api.auth.guest();
    const roomId = await api.chat.createRoom({ name });
    return { userId, roomId };
  }

  const texts = async (collection: {
    find(): { fetchAsync(): Promise<Array<{ text: string }>> };
  }) => (await collection.find().fetchAsync()).map((message) => message.text).sort();

  it("publishes a cursor into meteor-rpc:pub:<path>#<input hash>, with a meta document", async () => {
    const { roomId } = await loginWithRoom();
    await Messages.insertAsync({ roomId, userId: "u", text: "first", createdAt: new Date() });

    await ready((callbacks) => api.chat.messages.subscribe({ roomId }, callbacks));
    // collection(input) takes the same input as subscribe; asking for it after ready is fine.
    const messages = api.chat.messages.collection({ roomId });

    assert.match(nameOf(messages), /^meteor-rpc:pub:chat\.messages#[0-9a-z]+$/);
    assert.deepEqual(await texts(messages), ["first"]);
    const instance = instanceOf(messages);
    assert.deepEqual(await metaDoc(connection, instance), { _id: instance, shape: "cursor" });
  });

  it("keeps the documents of different inputs apart, even when subscribed at the same time", async () => {
    const { roomId: a } = await loginWithRoom("A");
    const b = await api.chat.createRoom({ name: "B" });
    await Messages.insertAsync({ roomId: a, userId: "u", text: "in A", createdAt: new Date() });
    await Messages.insertAsync({ roomId: b, userId: "u", text: "in B", createdAt: new Date() });

    await Promise.all([
      ready((callbacks) => api.chat.messages.subscribe({ roomId: a }, callbacks)),
      ready((callbacks) => api.chat.messages.subscribe({ roomId: b }, callbacks)),
    ]);
    const inA = api.chat.messages.collection({ roomId: a });
    const inB = api.chat.messages.collection({ roomId: b });
    assert.notEqual(nameOf(inA), nameOf(inB));
    assert.deepEqual(await texts(inA), ["in A"]);
    assert.deepEqual(await texts(inB), ["in B"]);

    // Live changes reach only the matching instance.
    await Messages.insertAsync({
      roomId: b,
      userId: "u",
      text: "later in B",
      createdAt: new Date(),
    });
    await waitFor(async () => (await texts(inB)).length === 2, "the new message in B");
    assert.deepEqual(await texts(inA), ["in A"]);

    // The same input in a different key order is the same instance (canonical EJSON).
    assert.equal(
      nameOf(api.chat.messages.collection({ limit: 10, roomId: a })),
      nameOf(api.chat.messages.collection({ roomId: a, limit: 10 })),
    );
  });

  it("keeps the client collection live after ready: insert, update, remove", async () => {
    const { roomId } = await loginWithRoom();
    await ready((callbacks) => api.chat.messages.subscribe({ roomId }, callbacks));
    const messages = api.chat.messages.collection({ roomId });

    const id = await Messages.insertAsync({
      roomId,
      userId: "u",
      text: "hello",
      createdAt: new Date(),
    });
    await waitFor(async () => (await texts(messages)).join() === "hello", "the inserted message");

    await Messages.updateAsync(id, { $set: { text: "edited" } });
    await waitFor(async () => (await texts(messages)).join() === "edited", "the updated message");

    await Messages.removeAsync(id);
    await waitFor(async () => (await messages.find().countAsync()) === 0, "the removed message");
  });

  it("is ready only after the initial documents arrived", async () => {
    const { roomId } = await loginWithRoom();
    const base = Date.now();
    for (let i = 0; i < 60; i++) {
      await Messages.insertAsync({
        roomId,
        userId: "u",
        text: `m${i}`,
        createdAt: new Date(base + i),
      });
    }
    const input = { roomId, limit: 100 };
    let countAtReady = -1;
    await new Promise<void>((resolve, reject) => {
      api.chat.messages.subscribe(input, {
        onReady: () => {
          countAtReady = api.chat.messages.collection(input).find().count();
          resolve();
        },
        onStop: reject,
      });
    });
    assert.equal(countAtReady, 60);
  });

  it("applies the schema's defaults to publication input (limit defaults to 50)", async () => {
    const { roomId } = await loginWithRoom();
    for (let i = 0; i < 55; i++) {
      await Messages.insertAsync({ roomId, userId: "u", text: `m${i}`, createdAt: new Date() });
    }
    await ready((callbacks) => api.chat.messages.subscribe({ roomId }, callbacks));
    assert.equal(await api.chat.messages.collection({ roomId }).find().countAsync(), 50);
  });

  it("publishes each key of a shared publication into its own collection, so equal _ids never collide", async () => {
    await api.auth.guest();
    await Rooms.insertAsync({ _id: "same", name: "Shared", ownerId: "u", createdAt: new Date() });
    await Members.insertAsync({ _id: "same", roomId: "same", userId: "u", joinedAt: new Date() });

    // On a server-side client, touch the key collections before subscribing to read them at ready.
    const { room, members } = api.chat.room.collections("same");
    await ready((callbacks) => api.chat.room.subscribe("same", callbacks));
    assert.match(nameOf(room), /^meteor-rpc:pub:chat\.room#[0-9a-z]+\/room$/);
    assert.match(nameOf(members), /^meteor-rpc:pub:chat\.room#[0-9a-z]+\/members$/);
    assert.deepEqual(await room.find().fetchAsync(), [
      {
        _id: "same",
        name: "Shared",
        ownerId: "u",
        createdAt: (await Rooms.findOneAsync("same"))!.createdAt,
      },
    ]);
    assert.equal((await members.findOneAsync("same"))?.userId, "u");
    const instance = instanceOf(room);
    assert.deepEqual(await metaDoc(connection, instance), {
      _id: instance,
      shape: "record",
      keys: ["room", "members"],
    });

    // Removing the member must not remove the room that shares its _id.
    await Members.removeAsync("same");
    await waitFor(async () => (await members.find().countAsync()) === 0, "the member removal");
    assert.equal((await room.findOneAsync("same"))?.name, "Shared");
  });

  it("accepts subscribe(callbacks) when the input is optional, and sends no input", async () => {
    // probe.maybe takes z.void(): if the callbacks were sent as input, validation would fail.
    const handle = await ready((callbacks) => probe.maybe.subscribe(callbacks));
    assert.equal(handle.ready(), true);
    assert.equal(nameOf(probe.maybe.collection()), "meteor-rpc:pub:probe.maybe");
  });

  it("is ready with no documents when the resolver returns nothing", async () => {
    await ready((callbacks) => probe.maybe.subscribe(callbacks)); // not logged in: returns undefined
    assert.equal(await probe.maybe.collection().find().countAsync(), 0);
    assert.deepEqual(await metaDoc(connection, "probe.maybe"), {
      _id: "probe.maybe",
      shape: "cursor",
    });

    await ready((callbacks) => probe.nothingShared.subscribe(callbacks));
    assert.deepEqual(await metaDoc(connection, "probe.nothingShared"), {
      _id: "probe.nothingShared",
      shape: "record",
      keys: [],
    });
  });

  it("lets a module middleware reject a publication", async () => {
    const error = await rejection(
      ready((callbacks) => api.chat.messages.subscribe({ roomId: "any" }, callbacks)),
    );
    assert.ok(isMeteorError(error), String(error));
    assert.equal(error.error, "not-authorized");
  });

  it("rejects invalid publication input with validation-error details", async () => {
    await api.auth.guest();
    const error = await rejection(
      ready((callbacks) =>
        api.chat.messages.subscribe({ roomId: 1 as unknown as string }, callbacks),
      ),
    );
    assert.ok(isValidationError(error), String(error));
    assert.deepEqual(error.details[0]?.path, ["roomId"]);
  });

  it("rejects more than one subscription argument", async () => {
    const error = await rejection(
      ready((callbacks) => connection.subscribe("rooms", 1, 2, callbacks)),
    );
    assert.ok(isValidationError(error), String(error));
    assert.match(String(error.reason), /at most 1 argument/);
  });
});
