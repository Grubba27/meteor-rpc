import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "../../src/client/index";
import { createModule } from "../../src/server/index";
import { fakeState, Meteor } from "../fakes/runtime";

const noop = () => null;

describe("createModule", () => {
  it("registers nested submodules under their full path", async () => {
    const deep = createModule("messages")
      .addMethod("send", z.string(), (text) => text)
      .buildSubmodule();
    const chat = createModule("chat").addSubmodule(deep).buildSubmodule();
    const server = createModule().addSubmodule(chat).build();
    await expect(Meteor.callAsync("chat.messages.send", "hi")).resolves.toBe("hi");
    await expect(createClient<typeof server>().chat.messages.send("hey")).resolves.toBe("hey");
  });

  it("returns a router describing every definition", () => {
    const chat = createModule("chat").addMethod("send", z.string(), noop).buildSubmodule();
    const server = createModule()
      .addMethod("ping", z.void(), noop)
      .addPublication("feed", z.void(), () => undefined)
      .addSubmodule(chat)
      .build();
    expect(server).toEqual({
      ping: { type: "method" },
      feed: { type: "publication" },
      chat: { send: { type: "method" } },
    });
    expect(Object.isFrozen(server)).toBe(true);
  });

  it("registers nothing until build()", async () => {
    createModule().addMethod("notYet", z.void(), noop);
    await expect(Meteor.callAsync("notYet")).rejects.toMatchObject({ error: 404 });
  });

  it("registers nothing on the client", async () => {
    fakeState.isServer = false;
    createModule().addMethod("clientOnly", z.void(), noop).build();
    fakeState.isServer = true;
    await expect(Meteor.callAsync("clientOnly")).rejects.toMatchObject({ error: 404 });
  });

  it("keeps builders immutable, so branches don't leak into each other", async () => {
    const base = createModule().addMethod("shared", z.void(), () => "shared");
    const a = base.addMethod("onlyA", z.void(), noop).build();
    expect(Object.keys(a)).toEqual(["shared", "onlyA"]);
    expect(() => base.addMethod("onlyB", z.void(), noop)).not.toThrow();
  });

  describe("validation of definitions", () => {
    it.each([
      ["a.b", /contains a dot/],
      ["", /non-empty/],
      ["then", /reserved/],
      ["subscribe", /reserved/],
      ["useThing", /reserved/],
      ["$helper", /reserved/],
    ])("rejects the name %j", (name, message) => {
      expect(() => createModule().addMethod(name as "x", z.void(), noop)).toThrow(message);
    });

    it("allows names that only look similar to reserved ones", () => {
      expect(() =>
        createModule().addMethod("user", z.void(), noop).addMethod("users", z.void(), noop),
      ).not.toThrow();
    });

    it("rejects duplicate names across kinds", () => {
      const builder = createModule().addMethod("item", z.void(), noop);
      expect(() => builder.addPublication("item" as never, z.void(), () => undefined)).toThrow(
        /already defined/,
      );
    });

    it("rejects schemas that are not Standard Schemas", () => {
      expect(() => createModule().addMethod("x", { parse: noop } as never, noop)).toThrow(
        /Standard Schema/,
      );
    });

    it("rejects a missing resolver", () => {
      expect(() => createModule().addMethod("x", z.void(), undefined as never)).toThrow(
        /must be a function/,
      );
    });

    it("rejects invalid namespaces", () => {
      expect(() => createModule("a.b")).toThrow(/contains a dot/);
    });
  });

  describe("build and buildSubmodule", () => {
    it("refuses build() on a namespaced module", () => {
      const chat = createModule("chat").addMethod("send", z.void(), noop);
      // @ts-expect-error build() is only for the root module
      expect(() => chat.build()).toThrow(/is a submodule/);
    });

    it("refuses buildSubmodule() on the root module", () => {
      // @ts-expect-error buildSubmodule() needs a namespace
      expect(() => createModule().buildSubmodule()).toThrow(/needs a namespace/);
    });

    it("refuses addSubmodule with anything but buildSubmodule()", () => {
      expect(() => createModule().addSubmodule({ name: "x", submodule: {} } as never)).toThrow(
        /buildSubmodule/,
      );
    });

    it("allows an empty root module", () => {
      expect(createModule().build()).toEqual({});
    });
  });
});
