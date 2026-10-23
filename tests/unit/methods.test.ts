import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { z as z3 } from "zod3";
import { createClient } from "../../src/client/index";
import { createModule } from "../../src/server/index";
import { isMeteorError, isValidationError } from "../../src/shared/errors";
import type { Middleware } from "../../src/shared/types";
import { fakeState, installRateLimiter, MeteorError, rateLimiterRules } from "../fakes/runtime";

describe("methods", () => {
  it("round-trips input and result through the client", async () => {
    const server = createModule()
      .addMethod("add", z.object({ a: z.number(), b: z.number() }), ({ a, b }) => a + b)
      .build();
    const api = createClient<typeof server>();
    await expect(api.add({ a: 1, b: 2 })).resolves.toBe(3);
  });

  it("accepts every Standard Schema library", async () => {
    const server = createModule()
      .addMethod("zod4", z.string(), (s) => s.toUpperCase())
      .addMethod("zod3", z3.string(), (s) => s.toUpperCase())
      .addMethod("valibot", v.string(), (s) => s.toUpperCase())
      .addMethod("arktype", type("string"), (s) => s.toUpperCase())
      .build();
    const api = createClient<typeof server>();
    await expect(api.zod4("a")).resolves.toBe("A");
    await expect(api.zod3("b")).resolves.toBe("B");
    await expect(api.valibot("c")).resolves.toBe("C");
    await expect(api.arktype("d")).resolves.toBe("D");
  });

  it("supports async validators", async () => {
    const schema = z.string().refine(async (value) => value === "ok", "must be ok");
    const server = createModule()
      .addMethod("asyncCheck", schema, (s) => s)
      .build();
    const api = createClient<typeof server>();
    await expect(api.asyncCheck("ok")).resolves.toBe("ok");
    await expect(api.asyncCheck("no")).rejects.toSatisfy(isValidationError);
  });

  it("calls void methods without sending an argument", async () => {
    const resolver = vi.fn(() => "pong");
    const server = createModule().addMethod("ping", z.void(), resolver).build();
    const api = createClient<typeof server>();
    await expect(api.ping()).resolves.toBe("pong");
    await expect(api.ping(undefined)).resolves.toBe("pong");
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("passes the parsed output (after transforms) to the resolver", async () => {
    const server = createModule()
      .addMethod("double", z.string().transform(Number), (n) => n * 2)
      .build();
    const api = createClient<typeof server>();
    await expect(api.double("21")).resolves.toBe(42);
  });

  it("binds this and passes the context", async () => {
    fakeState.userId = "user-1";
    let seen: unknown[] = [];
    const server = createModule()
      .addMethod("whoami", z.void(), function (_input, context) {
        seen = [
          this.userId,
          context.userId,
          context.name,
          context.type,
          context.invocation === this,
        ];
        return null;
      })
      .build();
    await createClient<typeof server>().whoami();
    expect(seen).toEqual(["user-1", "user-1", "whoami", "method", true]);
  });

  it("rejects more than one argument", async () => {
    createModule()
      .addMethod("one", z.number(), (n) => n)
      .build();
    const { Meteor } = await import("../fakes/runtime");
    await expect(Meteor.callAsync("one", 1, 2)).rejects.toSatisfy(isValidationError);
  });

  describe("errors", () => {
    it("throws validation errors with issues in details", async () => {
      const server = createModule()
        .addMethod("signup", z.object({ user: z.object({ email: z.email() }) }), () => true)
        .build();
      const api = createClient<typeof server>();
      const error = await api.signup({ user: { email: "nope" } }).catch((e: unknown) => e);
      expect(isValidationError(error)).toBe(true);
      if (!isValidationError(error)) return;
      expect(error.error).toBe("validation-error");
      expect(error.details[0]?.path).toEqual(["user", "email"]);
      expect(error.reason).toContain("user.email");
    });

    it("re-throws Meteor.Error from the resolver unchanged", async () => {
      const server = createModule()
        .addMethod("fail", z.void(), () => {
          throw new MeteorError("not-allowed", "Nope", { why: "test" });
        })
        .build();
      const error = await createClient<typeof server>()
        .fail()
        .catch((e: unknown) => e);
      expect(isMeteorError(error)).toBe(true);
      expect(error).toMatchObject({
        error: "not-allowed",
        reason: "Nope",
        details: { why: "test" },
      });
    });

    it("runs error hooks and still throws", async () => {
      const onErrorResolve = vi.fn();
      const server = createModule()
        .addMethod(
          "boom",
          z.void(),
          () => {
            throw new MeteorError("boom");
          },
          { hooks: { onErrorResolve: [onErrorResolve] } },
        )
        .build();
      await expect(createClient<typeof server>().boom()).rejects.toMatchObject({ error: "boom" });
      expect(onErrorResolve).toHaveBeenCalledOnce();
      expect(onErrorResolve.mock.calls[0]?.[0]).toMatchObject({
        name: "boom",
        error: { error: "boom" },
      });
    });

    it("gives error hooks parsed = undefined when validation fails", async () => {
      const onErrorResolve = vi.fn();
      const server = createModule()
        .addMethod("strict", z.number(), (n) => n, { hooks: { onErrorResolve: [onErrorResolve] } })
        .build();
      const api = createClient<typeof server>();
      await expect(api.strict("x" as unknown as number)).rejects.toSatisfy(isValidationError);
      expect(onErrorResolve.mock.calls[0]?.[0]).toMatchObject({ raw: "x", parsed: undefined });
    });

    it("keeps throwing the original error when an error hook throws", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const server = createModule()
        .addMethod(
          "hookFails",
          z.void(),
          () => {
            throw new MeteorError("original");
          },
          {
            hooks: {
              onErrorResolve: [
                () => {
                  throw new Error("hook");
                },
              ],
            },
          },
        )
        .build();
      await expect(createClient<typeof server>().hookFails()).rejects.toMatchObject({
        error: "original",
      });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("middlewares and hooks", () => {
    it("runs middlewares outer module first, then hooks, then the resolver", async () => {
      const order: string[] = [];
      const inner = createModule("inner")
        .addMiddlewares([() => void order.push("inner middleware")])
        .addMethod("run", z.void(), () => void order.push("resolver"), {
          hooks: {
            onBeforeResolve: [() => void order.push("before")],
            onAfterResolve: [() => void order.push("after")],
          },
        })
        .buildSubmodule();
      const server = createModule()
        .addMiddlewares([() => void order.push("root middleware")])
        .addSubmodule(inner)
        .build();
      await createClient<typeof server>().inner.run();
      expect(order).toEqual(["root middleware", "inner middleware", "before", "resolver", "after"]);
    });

    it("lets a middleware reject the call", async () => {
      const auth: Middleware = ({ userId }) => {
        if (!userId) throw new MeteorError("not-authorized");
      };
      const resolver = vi.fn(() => "secret");
      const server = createModule()
        .addMiddlewares([auth])
        .addMethod("secret", z.void(), resolver)
        .build();
      await expect(createClient<typeof server>().secret()).rejects.toMatchObject({
        error: "not-authorized",
      });
      expect(resolver).not.toHaveBeenCalled();
    });

    it("gives middlewares raw and parsed input", async () => {
      const middleware = vi.fn();
      const server = createModule()
        .addMiddlewares([middleware])
        .addMethod("num", z.string().transform(Number), (n) => n)
        .build();
      await createClient<typeof server>().num("7");
      expect(middleware.mock.calls[0]?.[0]).toMatchObject({
        type: "method",
        name: "num",
        raw: "7",
        parsed: 7,
      });
    });

    it("awaits after hooks and passes the result", async () => {
      const after = vi.fn(async (_context: unknown) => {});
      const server = createModule()
        .addMethod("value", z.void(), async () => 5, { hooks: { onAfterResolve: [after] } })
        .build();
      await createClient<typeof server>().value();
      expect(after.mock.calls[0]?.[0]).toMatchObject({ result: 5 });
    });

    it("does not share hook arrays between definitions", async () => {
      const shared = { hooks: { onBeforeResolve: [vi.fn()] } };
      const server = createModule()
        .addMethod("a", z.void(), () => 1, shared)
        .addMethod("b", z.void(), () => 2, shared)
        .build();
      shared.hooks.onBeforeResolve.push(vi.fn());
      const api = createClient<typeof server>();
      await api.a();
      expect(shared.hooks.onBeforeResolve[1]).not.toHaveBeenCalled();
    });

    it("applies middlewares exactly once even if build() is called twice", async () => {
      const middleware = vi.fn();
      const builder = createModule()
        .addMiddlewares([middleware])
        .addMethod("once", z.void(), () => 1);
      const first = builder.build();
      const second = builder.build();
      expect(second).toBe(first);
      await createClient<typeof first>().once();
      expect(middleware).toHaveBeenCalledOnce();
    });
  });

  describe("rate limits", () => {
    it("registers a per-connection rule", () => {
      createModule()
        .addMethod("limited", z.void(), () => 1, { rateLimit: { limit: 2, interval: 1000 } })
        .build();
      expect(rateLimiterRules).toHaveLength(1);
      expect(rateLimiterRules[0]).toMatchObject({
        limit: 2,
        interval: 1000,
        rule: { type: "method", name: "limited" },
      });
    });

    it("explains when ddp-rate-limiter is missing, and registers nothing", async () => {
      installRateLimiter(false);
      const builder = createModule()
        .addMethod("unlimited", z.void(), () => 1)
        .addMethod("limited", z.void(), () => 1, { rateLimit: { limit: 2, interval: 1000 } });
      expect(() => builder.build()).toThrow(/meteor add ddp-rate-limiter/);
      await expect((createClient<any>() as any).unlimited()).rejects.toMatchObject({ error: 404 });
    });

    it("rejects invalid limits", () => {
      const builder = createModule().addMethod("bad", z.void(), () => 1, {
        rateLimit: { limit: 0, interval: 1000 },
      });
      expect(() => builder.build()).toThrow(/positive integer/);
    });
  });
});
