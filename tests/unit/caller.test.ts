import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createClient } from "../../src/client/index";
import { createClient as createReactClient } from "../../src/react/index";
import { createCaller, createModule } from "../../src/server/index";
import { isValidationError } from "../../src/shared/errors";
import type { Middleware } from "../../src/shared/types";
import { fakeState, installPackages, MeteorError } from "../fakes/runtime";

describe("createCaller", () => {
  it("calls a submodule's methods by their full name, through validation and middlewares", async () => {
    const seen: string[] = [];
    const audit: Middleware = ({ name, userId }) => void seen.push(`${name} by ${userId}`);
    const customers = createModule("customers")
      .addMethod("isLocked", z.object({ id: z.string() }), ({ id }) => id === "locked")
      .buildSubmodule();
    createModule().addMiddlewares([audit]).addSubmodule(customers).build();
    fakeState.userId = "u1";

    const caller = createCaller(customers);
    await expect(caller.isLocked({ id: "locked" })).resolves.toBe(true);
    await expect(caller.isLocked({ id: 1 } as never)).rejects.toSatisfy(isValidationError);
    expect(seen).toEqual(["customers.isLocked by u1"]);
  });

  it("finds the full name of a nested submodule", async () => {
    const messages = createModule("messages")
      .addMethod("send", z.string(), (text) => `sent ${text}`)
      .buildSubmodule();
    const chat = createModule("chat").addSubmodule(messages).buildSubmodule();
    createModule().addSubmodule(chat).build();

    await expect(createCaller(messages).send("hi")).resolves.toBe("sent hi");
    await expect(createCaller(chat).messages.send("yo")).resolves.toBe("sent yo");
  });

  it("calls the methods of a root router", async () => {
    const sub = createModule("sub")
      .addMethod("echo", z.number(), (n) => n)
      .buildSubmodule();
    const server = createModule()
      .addMethod("ping", z.void(), () => "pong" as const)
      .addSubmodule(sub)
      .build();

    const caller = createCaller(server);
    await expect(caller.ping()).resolves.toBe("pong");
    await expect(caller.sub.echo(3)).resolves.toBe(3);
  });

  it("accepts parts of a router: server.chat, chat.submodule and deeper", async () => {
    const messages = createModule("messages")
      .addMethod("count", z.void(), () => 3)
      .buildSubmodule();
    const chat = createModule("chat").addSubmodule(messages).buildSubmodule();
    const server = createModule().addSubmodule(chat).build();

    await expect(createCaller(server.chat).messages.count()).resolves.toBe(3);
    await expect(createCaller(server.chat.messages).count()).resolves.toBe(3);
    await expect(createCaller(chat.submodule).messages.count()).resolves.toBe(3);
    await expect(createCaller(chat.submodule.messages).count()).resolves.toBe(3);
  });

  it("works from a publication resolver", async () => {
    const counter = createModule("counter")
      .addMethod("current", z.void(), (_input, { userId }) => `count for ${userId}`)
      .buildSubmodule();
    const seen: unknown[] = [];
    const feed = createModule("feed")
      .addPublication("latest", z.void(), async () => {
        seen.push(await createCaller(counter).current());
        return undefined;
      })
      .buildSubmodule();
    const server = createModule().addSubmodule(counter).addSubmodule(feed).build();
    fakeState.userId = "u2";

    const handle = createClient<typeof server>().feed.latest.subscribe();
    await vi.waitFor(() => expect(seen).toEqual(["count for u2"]));
    handle.stop();
  });

  it("can be created before the root module is built, and resolves the name when called", async () => {
    const tasks = createModule("tasks")
      .addMethod("count", z.void(), () => 2)
      .buildSubmodule();
    const caller = createCaller(tasks);
    await expect(caller.count()).rejects.toThrow(/isn't part of a built module yet/);

    createModule().addSubmodule(tasks).build();
    await expect(caller.count()).resolves.toBe(2);
  });

  it("rejects when the submodule is added in several places", async () => {
    const shared = createModule("shared")
      .addMethod("run", z.void(), () => 1)
      .buildSubmodule();
    createModule()
      .addSubmodule(shared)
      .addSubmodule(createModule("other").addSubmodule(shared).buildSubmodule())
      .build();
    await expect(createCaller(shared).run()).rejects.toThrow(
      /several places \(shared, other\.shared\)/,
    );
  });

  it("passes errors from the method through", async () => {
    const auth = createModule("auth")
      .addMethod("secret", z.void(), () => {
        throw new MeteorError("not-authorized", "Log in first");
      })
      .buildSubmodule();
    createModule().addSubmodule(auth).build();
    await expect(createCaller(auth).secret()).rejects.toMatchObject({ error: "not-authorized" });
  });

  it("only accepts built modules", () => {
    expect(() => createCaller({} as never)).toThrow(
      /expects a module from buildSubmodule\(\) or build\(\)/,
    );
    expect(() => createCaller(createModule("x") as never)).toThrow(TypeError);
  });
});

describe("creating a client", () => {
  it("doesn't read the Package global until it's used", () => {
    const global = globalThis as { Package?: unknown };
    const saved = global.Package;
    delete global.Package;
    try {
      expect(() => createClient<any>()).not.toThrow();
      expect(() => createReactClient<any>()).not.toThrow();
      const tasks = createModule("tasks").addMethod("x", z.void(), vi.fn()).buildSubmodule();
      expect(() => createCaller(tasks)).not.toThrow();
    } finally {
      global.Package = saved;
      installPackages();
    }
  });
});
