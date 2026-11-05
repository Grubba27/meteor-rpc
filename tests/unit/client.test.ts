import { describe, expect, it, vi } from "vitest";
import { createClient } from "../../src/client/index";
import { createProxy } from "../../src/client/proxy";
import type { Transport } from "../../src/client/transport";
import { fakeState } from "../fakes/runtime";

function fakeTransport(): Transport & { call: ReturnType<typeof vi.fn> } {
  return {
    connection: {},
    canSubscribe: true,
    call: vi.fn(async (name: string, input: unknown) => ({ name, input })),
    subscribe: vi.fn(),
    collection: vi.fn(),
  } as never;
}

describe("client proxy", () => {
  it("turns property paths into dotted method names", async () => {
    const transport = fakeTransport();
    const api = createProxy(transport, {}) as any;
    await api.chat.messages.send({ text: "hi" });
    expect(transport.call).toHaveBeenCalledWith("chat.messages.send", { text: "hi" });
  });

  it("routes helper calls with the path of the definition", () => {
    const helper = vi.fn(() => "helped");
    const transport = fakeTransport();
    const api = createProxy(transport, { useThing: helper }) as any;
    expect(api.chat.rooms.useThing(1, 2)).toBe("helped");
    expect(helper).toHaveBeenCalledWith(transport, "chat.rooms", [1, 2]);
  });

  it("is safe to store a helper and call it repeatedly", () => {
    const helper = vi.fn();
    const api = createProxy(fakeTransport(), { useThing: helper }) as any;
    const stored = api.todos.list.useThing;
    stored();
    stored();
    expect(helper.mock.calls.map((call) => call[1])).toEqual(["todos.list", "todos.list"]);
  });

  it("is not thenable, serializable or inspectable as a path", async () => {
    const transport = fakeTransport();
    const api = createProxy(transport, {}) as any;
    expect(api.then).toBeUndefined();
    expect(api.todos.toJSON).toBeUndefined();
    expect(api.$$typeof).toBeUndefined();
    await expect(Promise.resolve(api)).resolves.toBe(api);
    expect(transport.call).not.toHaveBeenCalled();
  });

  it("refuses to call the root", () => {
    const api = createProxy(fakeTransport(), {}) as any;
    expect(() => api()).toThrow(/call a method/);
  });

  it("only treats a helper name as a helper below the root", async () => {
    const transport = fakeTransport();
    const api = createProxy(transport, { subscribe: vi.fn() }) as any;
    await api.subscribe("x");
    expect(transport.call).toHaveBeenCalledWith("subscribe", "x");
  });
});

describe("createClient transport", () => {
  it("refuses subscriptions on the server with the default connection", () => {
    fakeState.isClient = false;
    const api = createClient<any>() as any;
    expect(() => api.feed.subscribe()).toThrow(/pass a DDP connection/);
    expect(() => api.feed.collection()).toThrow(/only exists on the client/);
  });
});
