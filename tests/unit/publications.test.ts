import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createClient } from "../../src/client/index";
import { createTransport } from "../../src/client/transport";
import { createModule } from "../../src/server/index";
import { isValidationError } from "../../src/shared/errors";
import { META_COLLECTION } from "../../src/shared/names";
import { Collection, createFakeConnection, MeteorError, rateLimiterRules } from "../fakes/runtime";

let counter = 0;
const unique = (name: string) => `${name}${++counter}`;

/** Subscribes and resolves once ready, or rejects with the stop error. */
function ready(
  subscribe: (callbacks: { onReady: () => void; onStop: (e?: unknown) => void }) => unknown,
) {
  return new Promise<void>((resolve, reject) => {
    subscribe({ onReady: resolve, onStop: (error) => reject(error ?? new Error("stopped")) });
  });
}

describe("publications", () => {
  it("publishes a cursor into its own client collection and stays live", async () => {
    const Rooms = new Collection<{ _id: string; name: string; open: boolean }>(unique("rooms"));
    await Rooms.insertAsync({ _id: "r1", name: "General", open: true });
    await Rooms.insertAsync({ _id: "r2", name: "Closed", open: false });

    const server = createModule()
      .addPublication("openRooms", z.void(), () => Rooms.find({ open: true }))
      .build();
    const api = createClient<typeof server>();

    await ready((callbacks) => api.openRooms.subscribe(undefined, callbacks));
    const collection = api.openRooms.collection() as unknown as Collection;
    expect(collection.all()).toEqual([{ _id: "r1", name: "General", open: true }]);

    await Rooms.insertAsync({ _id: "r3", name: "Random", open: true });
    await Rooms.updateAsync("r1", { name: "Lobby" });
    expect(collection.all().map((room) => room.name)).toEqual(["Lobby", "Random"]);

    await Rooms.removeAsync("r3");
    expect(collection.all()).toHaveLength(1);
  });

  it("sends a meta document describing the shape", async () => {
    const server = createModule()
      .addPublication("plain", z.void(), () => undefined)
      .addSharedPublication("shared", z.void(), () => ({ a: null, b: null }))
      .build();
    const api = createClient<typeof server>();
    await ready((callbacks) => api.plain.subscribe(undefined, callbacks));
    await ready((callbacks) => api.shared.subscribe(undefined, callbacks));
    const meta = createTransport().collection(META_COLLECTION) as unknown as Collection;
    expect(meta.all()).toEqual([
      { _id: "plain", shape: "cursor" },
      { _id: "shared", shape: "record", keys: ["a", "b"] },
    ]);
  });

  it("validates input and passes the parsed value", async () => {
    const resolver = vi.fn((_input: unknown) => undefined);
    const server = createModule()
      .addPublication("byPage", z.object({ page: z.coerce.number() }), resolver)
      .build();
    const api = createClient<typeof server>();
    await ready((callbacks) => api.byPage.subscribe({ page: "2" as unknown as number }, callbacks));
    expect(resolver.mock.calls[0]?.[0]).toEqual({ page: 2 });

    const error = await ready((callbacks) =>
      api.byPage.subscribe({ page: "x" as unknown as number }, callbacks),
    ).catch((e: unknown) => e);
    expect(isValidationError(error)).toBe(true);
  });

  it("runs module middlewares for publications too", async () => {
    const server = createModule()
      .addMiddlewares([
        ({ type, userId }) => {
          if (type === "publication" && !userId) throw new MeteorError("not-authorized");
        },
      ])
      .addPublication("private", z.void(), () => undefined)
      .build();
    const api = createClient<typeof server>();
    await expect(
      ready((callbacks) => api.private.subscribe(undefined, callbacks)),
    ).rejects.toMatchObject({
      error: "not-authorized",
    });
  });

  it("runs publication hooks and registers rate limits", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const server = createModule()
      .addPublication("hooked", z.void(), () => undefined, {
        hooks: { onBeforeResolve: [before], onAfterResolve: [after] },
        rateLimit: { limit: 1, interval: 500 },
      })
      .build();
    await ready((callbacks) =>
      createClient<typeof server>().hooked.subscribe(undefined, callbacks),
    );
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(rateLimiterRules[0]?.rule).toMatchObject({ type: "subscription", name: "hooked" });
  });

  it("keeps documents of different keys apart in shared publications", async () => {
    const Users = new Collection(unique("users"));
    const Posts = new Collection(unique("posts"));
    await Users.insertAsync({ _id: "same", kind: "user" });
    await Posts.insertAsync({ _id: "same", kind: "post" });

    const server = createModule()
      .addSharedPublication("feed", z.void(), () => ({ users: Users.find(), posts: Posts.find() }))
      .build();
    const api = createClient<typeof server>();
    await ready((callbacks) => api.feed.subscribe(undefined, callbacks));

    expect((api.feed.collections().users as unknown as Collection).all()).toEqual([
      { _id: "same", kind: "user" },
    ]);
    expect((api.feed.collections().posts as unknown as Collection).all()).toEqual([
      { _id: "same", kind: "post" },
    ]);

    await Posts.removeAsync("same");
    expect((api.feed.collections().users as unknown as Collection).all()).toHaveLength(1);
  });

  it("removes documents when the subscription stops", async () => {
    const Items = new Collection(unique("items"));
    await Items.insertAsync({ _id: "i1" });
    const server = createModule()
      .addPublication("items", z.void(), () => Items.find())
      .build();
    const api = createClient<typeof server>();
    let handle: { stop(): void } | undefined;
    await ready((callbacks) => {
      handle = api.items.subscribe(undefined, callbacks);
    });
    const collection = api.items.collection() as unknown as Collection;
    expect(collection.all()).toHaveLength(1);
    handle?.stop();
    expect(collection.all()).toHaveLength(0);
    await Items.insertAsync({ _id: "i2" });
    expect(collection.all()).toHaveLength(0);
  });

  it("explains a wrong return shape", async () => {
    const Things = new Collection(unique("things"));
    const server = createModule()
      .addPublication("array", z.void(), () => [Things.find()] as never)
      .addSharedPublication("cursor", z.void(), () => Things.find() as never)
      .build();
    const api = createClient<typeof server>();
    // Non-Meteor errors are sanitized on the wire; the server log has the explanation.
    await expect(
      ready((callbacks) => api.array.subscribe(undefined, callbacks)),
    ).rejects.toMatchObject({ error: 500 });
    await expect(
      ready((callbacks) => api.cursor.subscribe(undefined, callbacks)),
    ).rejects.toMatchObject({ error: 500 });
  });

  it("keeps documents of different inputs apart", async () => {
    const Messages = new Collection<{ _id: string; room: string }>(unique("messages"));
    await Messages.insertAsync({ _id: "m1", room: "a" });
    await Messages.insertAsync({ _id: "m2", room: "b" });
    const server = createModule()
      .addPublication("messages", z.object({ room: z.string() }), ({ room }) =>
        Messages.find({ room }),
      )
      .build();
    const api = createClient<typeof server>();
    await ready((callbacks) => api.messages.subscribe({ room: "a" }, callbacks));
    await ready((callbacks) => api.messages.subscribe({ room: "b" }, callbacks));
    const ids = (room: string) =>
      (api.messages.collection({ room }) as unknown as Collection).all().map((doc) => doc._id);
    expect(ids("a")).toEqual(["m1"]);
    expect(ids("b")).toEqual(["m2"]);
  });

  it("accepts callbacks as the only argument when there is no input", async () => {
    const server = createModule()
      .addPublication("noInput", z.void(), () => undefined)
      .build();
    const api = createClient<typeof server>();
    await ready((callbacks) => api.noInput.subscribe(callbacks));
  });

  it("works over a custom connection", async () => {
    const Notes = new Collection(unique("notes"));
    await Notes.insertAsync({ _id: "n1", text: "hi" });
    const server = createModule()
      .addPublication("notes", z.void(), () => Notes.find())
      .build();
    const api = createClient<typeof server>({ connection: createFakeConnection("remote") });
    await ready((callbacks) => api.notes.subscribe(undefined, callbacks));
    expect((api.notes.collection() as unknown as Collection).all()).toEqual([
      { _id: "n1", text: "hi" },
    ]);
  });
});
