// A second root module, registered only in tests, that records what the server sees.
// Its names live under "probe." so they never clash with the example API.
import { Meteor } from "meteor/meteor";
import { createModule, type MiddlewareContext } from "meteor-rpc/server";
import { z } from "zod";
import { Messages } from "/imports/api/collections";

/** Everything the probe middlewares, hooks and resolvers saw, in order. */
export const events: string[] = [];
export const errorHookCalls: Array<{ name: string; error: unknown; parsed: unknown }> = [];

const record =
  (label: string) =>
  ({ type, name }: Pick<MiddlewareContext, "type" | "name">) => {
    events.push(`${label}:${type}:${name}`);
  };

const inner = createModule("inner")
  .addMiddlewares([record("inner")])
  .addMethod(
    "run",
    z.void(),
    () => {
      events.push("resolver:method");
      return "ran" as const;
    },
    {
      hooks: { onBeforeResolve: [record("before")], onAfterResolve: [record("after")] },
    },
  )
  .addPublication(
    "watch",
    z.void(),
    () => {
      events.push("resolver:publication");
      return Messages.find({ _id: "nothing" });
    },
    {
      hooks: { onBeforeResolve: [record("before")], onAfterResolve: [record("after")] },
    },
  )
  .buildSubmodule();

const outer = createModule("outer")
  .addMiddlewares([record("outer")])
  .addSubmodule(inner)
  .buildSubmodule();

const probe = createModule("probe")
  .addMiddlewares([record("probe")])
  .addSubmodule(outer)
  .addMethod("whoami", z.void(), async function (_input, ctx) {
    return {
      thisUserId: this.userId,
      ctxUserId: ctx.userId,
      sameInvocation: this === ctx.invocation,
      type: ctx.type,
      name: ctx.name,
      hasConnection: ctx.connection !== null,
    };
  })
  .addMethod("loginAs", z.string(), async function (userId) {
    await this.setUserId(userId);
    return userId;
  })
  .addMethod(
    "measure",
    z.string().transform((value) => value.length),
    (input) => ({
      value: input,
      type: typeof input,
    }),
  )
  .addMethod(
    "fail",
    z.enum(["meteor", "plain", "async-meteor"]),
    async (kind) => {
      if (kind === "plain") throw new Error("secret internal detail");
      if (kind === "async-meteor") await new Promise((resolve) => setTimeout(resolve, 5));
      // @types/meteor types `details` as a string; Meteor sends any EJSON value.
      throw new Meteor.Error("probe-failed", "Probe failed", { kind } as unknown as string);
    },
    {
      hooks: {
        onErrorResolve: [
          ({ name, error, parsed }) => {
            errorHookCalls.push({ name, error, parsed });
          },
        ],
      },
    },
  )
  .addMethod("strict", z.object({ count: z.number().int() }), ({ count }) => count, {
    hooks: {
      onErrorResolve: [
        ({ name, error, parsed }) => {
          errorHookCalls.push({ name, error, parsed });
        },
      ],
    },
  })
  .addMethod("limited", z.void(), () => "ok" as const, {
    rateLimit: { limit: 2, interval: 60_000 },
  })
  .addPublication("limitedPub", z.number(), () => undefined, {
    rateLimit: { limit: 1, interval: 60_000 },
  })
  // The usual "not allowed" idiom: return nothing and the subscription is simply ready.
  .addPublication("maybe", z.void(), function () {
    if (!this.userId) return undefined;
    return Messages.find({ userId: this.userId });
  })
  .addSharedPublication("nothingShared", z.void(), () => undefined)
  .buildSubmodule();

export const probeServer = createModule().addSubmodule(probe).build();
export type ProbeServer = typeof probeServer;
