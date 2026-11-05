import { strict as assert } from "node:assert";
import { Meteor } from "meteor/meteor";
import { createClient, isMeteorError } from "meteor-rpc/client";
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import type { Server } from "/imports/api/server";
import { connect, disconnectAll, newClient, ready, rejection, resetDb } from "./helpers";
import type { ProbeServer } from "./probe-module";

const isTooManyRequests = (error: unknown) =>
  isMeteorError(error) && error.error === "too-many-requests";

describe("rateLimit", () => {
  beforeEach(resetDb);
  afterEach(disconnectAll);

  async function probeClient() {
    const connection = await connect();
    return { connection, probe: createClient<ProbeServer>({ connection }).probe };
  }

  it("limits a method per connection", async () => {
    const a = await probeClient();
    const b = await probeClient();

    assert.equal(await a.probe.limited(), "ok");
    assert.equal(await a.probe.limited(), "ok");
    assert.ok(isTooManyRequests(await rejection(a.probe.limited())));

    // Another connection has its own budget.
    assert.equal(await b.probe.limited(), "ok");
  });

  it("limits a publication per connection", async () => {
    const a = await probeClient();
    const b = await probeClient();

    await ready((callbacks) => a.probe.limitedPub.subscribe(1, callbacks));
    const error = await rejection(ready((callbacks) => a.probe.limitedPub.subscribe(2, callbacks)));
    assert.ok(isTooManyRequests(error), String(error));

    await ready((callbacks) => b.probe.limitedPub.subscribe(3, callbacks));
  });

  it("enforces the example's chat.send limit (5 per second)", async () => {
    const { api } = await newClient<Server>();
    await api.auth.guest();
    const roomId = await api.chat.createRoom({ name: "Busy" });
    // 12 calls in well under a second: even if a 1s window resets midway, at most 10 pass.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => api.chat.send({ roomId, text: `m${i}` })),
    );
    const limited = results.filter((result) => result.status === "rejected");
    assert.ok(limited.length >= 2, `expected some calls to be limited, got ${limited.length}`);
    assert.ok(
      limited.every((result) => isTooManyRequests((result as PromiseRejectedResult).reason)),
    );
  });

  it("fails build() with a clear error when ddp-rate-limiter is missing, before registering anything", () => {
    const packages = (globalThis as unknown as { Package: Record<string, unknown> }).Package;
    const saved = packages["ddp-rate-limiter"];
    packages["ddp-rate-limiter"] = undefined;
    try {
      const builder = createModule().addMethod("rateLimitedWithoutPackage", z.void(), () => 1, {
        rateLimit: { limit: 1, interval: 1000 },
      });
      assert.throws(() => builder.build(), /meteor add ddp-rate-limiter/);
    } finally {
      packages["ddp-rate-limiter"] = saved;
    }
    const handlers = (Meteor as unknown as { server: { method_handlers: Record<string, unknown> } })
      .server.method_handlers;
    assert.equal(
      handlers.rateLimitedWithoutPackage,
      undefined,
      "the method was registered without its rate limit",
    );
  });
});
