import { strict as assert } from "node:assert";
import { isMeteorError, isValidationError } from "meteor-rpc/client";
import { createClient as createReactClient } from "meteor-rpc/react";
import { Messages, Rooms } from "/imports/api/collections";
import type { Server } from "/imports/api/server";
import { type Connection, disconnectAll, newClient, rejection, resetDb } from "./helpers";
import { errorHookCalls, type ProbeServer } from "./probe-module";

describe("methods", () => {
  let connection: Connection;
  let api: ReturnType<typeof createReactClient<Server>>;
  let probe: ReturnType<typeof createReactClient<ProbeServer>>["probe"];

  beforeEach(async () => {
    await resetDb();
    ({ connection } = await newClient<Server>());
    // The React client also works without React for plain calls; its helpers are what hooks use.
    api = createReactClient<Server>({ connection });
    probe = createReactClient<ProbeServer>({ connection }).probe;
    errorHookCalls.length = 0;
  });

  afterEach(disconnectAll);

  it("round-trips a method with void input: no argument, explicit undefined, and the useMutation path", async () => {
    assert.equal(await api.ping(), "pong");
    assert.equal(await api.ping(undefined), "pong");
    // useMutation().mutate() calls mutationFn(undefined). It must not send `null` over DDP.
    const { mutationFn } = api.ping.mutationOptions();
    assert.equal(await mutationFn!(undefined), "pong");
    // The same for useQuery/useSuspenseQuery.
    const { queryFn, queryKey } = api.ping.queryOptions();
    assert.deepEqual(queryKey, ["ping"]);
    assert.equal(await (queryFn as () => Promise<unknown>)(), "pong");
  });

  it("documents why: raw DDP turns an undefined argument into null, which z.void() rejects", async () => {
    const error = await rejection(connection.callAsync("ping", undefined));
    assert.ok(isValidationError(error), String(error));
  });

  it("rejects more than one argument", async () => {
    const error = await rejection(connection.callAsync("ping", 1, 2));
    assert.ok(isValidationError(error));
    assert.match(String(error.reason), /at most 1 argument/);
  });

  it("gives the resolver the parsed output, not the raw input (zod and valibot)", async () => {
    assert.deepEqual(await probe.measure("hello"), { value: 5, type: "number" });

    await api.auth.guest();
    const roomId = await api.chat.createRoom({ name: "  Lobby  " }); // zod .trim()
    assert.equal((await Rooms.findOneAsync(roomId))?.name, "Lobby");
    const messageId = await api.chat.send({ roomId, text: "  hi  " }); // valibot v.trim()
    assert.equal((await Messages.findOneAsync(messageId))?.text, "hi");
  });

  it("binds `this` to the method invocation and passes ctx with the userId", async () => {
    const anonymous = await probe.whoami();
    assert.deepEqual(anonymous, {
      thisUserId: null,
      ctxUserId: null,
      sameInvocation: true,
      type: "method",
      name: "probe.whoami",
      hasConnection: true,
    });

    await probe.loginAs("user-1"); // this.setUserId() inside a resolver
    const loggedIn = await probe.whoami();
    assert.equal(loggedIn.thisUserId, "user-1");
    assert.equal(loggedIn.ctxUserId, "user-1");
  });

  it("throws the resolver's Meteor.Error with error, reason and details intact", async () => {
    for (const kind of ["meteor", "async-meteor"] as const) {
      const error = await rejection(probe.fail(kind));
      assert.ok(isMeteorError(error));
      assert.equal(error.error, "probe-failed");
      assert.equal(error.reason, "Probe failed");
      assert.deepEqual(error.details, { kind });
    }
  });

  it("throws (never returns) unexpected errors, sanitized by Meteor to a 500", async () => {
    const error = await rejection(probe.fail("plain"));
    assert.ok(isMeteorError(error));
    assert.equal(error.error, 500);
    assert.doesNotMatch(String(error.message), /secret internal detail/);
  });

  it("throws validation-error with one issue per invalid field in details", async () => {
    await api.auth.guest();

    const zodError = await rejection(api.chat.createRoom({ name: 42 as unknown as string }));
    assert.ok(isValidationError(zodError), String(zodError));
    assert.deepEqual(
      zodError.details.map((issue) => issue.path),
      [["name"]],
    );
    assert.match(String(zodError.reason), /^Validation failed: name: /);

    const valibotError = await rejection(api.chat.send({ roomId: "r1", text: "   " }));
    assert.ok(isValidationError(valibotError));
    assert.deepEqual(valibotError.details, [{ message: "Message can't be empty", path: ["text"] }]);
  });

  it("runs onErrorResolve hooks with the error, then re-throws the same error to the caller", async () => {
    const error = await rejection(probe.fail("meteor"));
    assert.equal(errorHookCalls.length, 1);
    const call = errorHookCalls[0]!;
    assert.equal(call.name, "probe.fail");
    assert.equal(call.parsed, "meteor");
    assert.ok(isMeteorError(call.error));
    assert.equal(call.error.error, error.error);

    // Validation failures reach the hooks too, with `parsed` undefined.
    errorHookCalls.length = 0;
    const invalid = await rejection(probe.strict({ count: 1.5 }));
    assert.ok(isValidationError(invalid));
    assert.equal(errorHookCalls.length, 1);
    assert.equal(errorHookCalls[0]!.parsed, undefined);
    assert.ok(isValidationError(errorHookCalls[0]!.error));
    assert.equal(await probe.strict({ count: 2 }), 2);
  });

  it("lets a module middleware reject a method", async () => {
    const error = await rejection(api.chat.createRoom({ name: "No user" }));
    assert.ok(isMeteorError(error));
    assert.equal(error.error, "not-authorized");
    assert.equal(await Rooms.find().countAsync(), 0);
  });
});
