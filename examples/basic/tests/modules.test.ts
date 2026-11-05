import { strict as assert } from "node:assert";
import { Meteor } from "meteor/meteor";
import { type Client, createClient, isMeteorError } from "meteor-rpc/client";
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import { Messages } from "/imports/api/collections";
import type { Server } from "/imports/api/server";
import { type Connection, disconnectAll, newClient, ready, rejection, resetDb } from "./helpers";
import { events, type ProbeServer } from "./probe-module";

const server = (Meteor as unknown as { server: unknown }).server as {
  method_handlers: Record<string, unknown>;
  publish_handlers: Record<string, unknown>;
};

describe("modules", () => {
  let connection: Connection;
  let api: Client<Server>;
  let probe: Client<ProbeServer>["probe"];

  beforeEach(async () => {
    await resetDb();
    ({ connection, api } = await newClient<Server>());
    probe = createClient<ProbeServer>({ connection }).probe;
    events.length = 0;
  });

  afterEach(disconnectAll);

  it("registers full dotted names, including nested submodules", () => {
    for (const name of [
      "ping",
      "auth.guest",
      "chat.createRoom",
      "chat.send",
      "chat.moderation.deleteMessage",
    ]) {
      assert.ok(server.method_handlers[name], `method ${name}`);
    }
    for (const name of ["rooms", "chat.messages", "chat.room", "probe.outer.inner.watch"]) {
      assert.ok(server.publish_handlers[name], `publication ${name}`);
    }
    assert.ok(server.method_handlers["probe.outer.inner.run"]);
    assert.equal(server.method_handlers["moderation.deleteMessage"], undefined);
  });

  it("createCaller calls other modules from a resolver, with the caller's userId", async () => {
    await probe.loginAs("caller-user");
    events.length = 0;
    const result = await probe.viaCaller();
    assert.deepEqual(result, {
      ran: "ran",
      who: { thisUserId: "caller-user", ctxUserId: "caller-user" },
    });
    // Each nested call runs the whole pipeline, root middlewares first.
    assert.deepEqual(events, [
      "probe:method:probe.viaCaller",
      "probe:method:probe.outer.inner.run",
      "outer:method:probe.outer.inner.run",
      "inner:method:probe.outer.inner.run",
      "before:method:probe.outer.inner.run",
      "resolver:method",
      "after:method:probe.outer.inner.run",
      "probe:method:probe.callee.whoami",
      "callee:probe.callee.whoami",
    ]);
  });

  it("calls a nested submodule method end to end (chat.moderation.deleteMessage)", async () => {
    await api.auth.guest();
    const roomId = await api.chat.createRoom({ name: "Mine" });
    const messageId = await api.chat.send({ roomId, text: "delete me" });
    assert.equal(await api.chat.moderation.deleteMessage({ messageId }), 1);
    assert.equal(await Messages.findOneAsync(messageId), undefined);

    // Its own middleware runs after the chat middleware: a user without rooms is "forbidden".
    const other = await newClient<Server>();
    await other.api.auth.guest();
    const error = await rejection(other.api.chat.moderation.deleteMessage({ messageId: "x" }));
    assert.ok(isMeteorError(error));
    assert.equal(error.error, "forbidden");
  });

  it("runs middlewares outer module first, then hooks, then the resolver (methods)", async () => {
    assert.equal(await probe.outer.inner.run(), "ran");
    const name = "probe.outer.inner.run";
    assert.deepEqual(events, [
      `probe:method:${name}`,
      `outer:method:${name}`,
      `inner:method:${name}`,
      `before:method:${name}`,
      "resolver:method",
      `after:method:${name}`,
    ]);
  });

  it("runs the same middlewares and hooks for publications", async () => {
    await ready((callbacks) => probe.outer.inner.watch.subscribe(callbacks));
    const name = "probe.outer.inner.watch";
    assert.deepEqual(events, [
      `probe:publication:${name}`,
      `outer:publication:${name}`,
      `inner:publication:${name}`,
      `before:publication:${name}`,
      "resolver:publication",
      `after:publication:${name}`,
    ]);
  });

  it("build() is idempotent: same router, registered once, middlewares applied once", async () => {
    let calls = 0;
    const builder = createModule()
      .addMiddlewares([() => void calls++])
      .addMethod("idempotentBuild", z.void(), () => "ok" as const);
    const first = builder.build();
    const second = builder.build(); // would throw "A method named ... is already defined" if it re-registered
    assert.equal(first, second);

    const client = createClient<typeof first>({ connection });
    assert.equal(await client.idempotentBuild(), "ok");
    assert.equal(calls, 1);
  });

  it("rejects modules that could never be called correctly", () => {
    const sub = createModule("namespaced").addMethod("x", z.void(), () => 1);
    assert.throws(() => (sub as any).build(), /buildSubmodule/);
    assert.throws(() => (createModule() as any).buildSubmodule(), /namespace/);
    assert.throws(
      () => createModule().addMethod("a.b" as any, z.void(), () => 1),
      /contains a dot/,
    );
    assert.throws(() => createModule().addMethod("useThing" as any, z.void(), () => 1), /reserved/);
    assert.throws(() => createModule().addMethod("then" as any, z.void(), () => 1), /reserved/);
    assert.throws(
      () =>
        createModule()
          .addMethod("twice", z.void(), () => 1)
          .addMethod("twice" as any, z.void(), () => 2),
      /already defined/,
    );
    assert.throws(
      () => createModule().addMethod("noSchema", {} as any, () => 1),
      /Standard Schema/,
    );
  });
});
