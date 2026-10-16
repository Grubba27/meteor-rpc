// Type-level contract of the public API. If one of these changes, it is a breaking
// change for users (see CONTRIBUTING.md): only additions are allowed in 2.x.
import type {
  UseMutationResult,
  UseQueryResult,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
import { type } from "arktype";
import * as v from "valibot";
import { describe, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { z as z3 } from "zod3";
import type { ClientCollection, SubscriptionHandle } from "../../src/client/index";
import { createClient as createCoreClient } from "../../src/client/index";
import { createClient } from "../../src/react/index";
import {
  createModule,
  type MethodContext,
  type PublicationContext,
  type Subscription,
} from "../../src/server/index";

interface Room {
  _id: string;
  name: string;
}
interface Message {
  _id: string;
  text: string;
}
declare const Rooms: { find(selector?: object): { fetch(): Room[] } };
declare const Messages: { find(selector?: object): { fetch(): Message[] } };

const messages = createModule("messages")
  .addMethod("send", z.object({ text: z.string() }), async ({ text }) => ({ id: "1", text }))
  .buildSubmodule();

const chat = createModule("chat")
  .addSubmodule(messages)
  .addPublication("rooms", z.void(), () => Rooms.find())
  .addSharedPublication("room", z.string(), (roomId) => ({
    room: Rooms.find({ _id: roomId }),
    messages: Messages.find({ roomId }),
  }))
  .buildSubmodule();

const server = createModule()
  .addMethod("ping", z.void(), () => "pong" as const)
  .addMethod("double", z.string().transform(Number), (n) => n * 2)
  .addMethod("optional", z.number().optional(), (n) => n ?? 0)
  .addMethod("zod3", z3.object({ a: z3.number() }), ({ a }) => a)
  .addMethod("valibot", v.object({ b: v.string() }), ({ b }) => b)
  .addMethod("arktype", type({ c: "boolean" }), ({ c }) => c)
  .addSubmodule(chat)
  .build();

type Server = typeof server;

describe("core client", () => {
  const api = createCoreClient<Server>();

  it("infers inputs and results", () => {
    expectTypeOf(api.ping).toBeCallableWith();
    expectTypeOf(api.ping()).toEqualTypeOf<Promise<"pong">>();
    expectTypeOf(api.double).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(api.double("2")).toEqualTypeOf<Promise<number>>();
    expectTypeOf(api.chat.messages.send({ text: "hi" })).toEqualTypeOf<
      Promise<{ id: string; text: string }>
    >();
  });

  it("works with zod 3, valibot and arktype", () => {
    expectTypeOf(api.zod3).parameter(0).toEqualTypeOf<{ a: number }>();
    expectTypeOf(api.valibot).parameter(0).toEqualTypeOf<{ b: string }>();
    expectTypeOf(api.arktype).parameter(0).toEqualTypeOf<{ c: boolean }>();
  });

  it("makes input optional only when the schema accepts undefined", () => {
    expectTypeOf(api.optional).toBeCallableWith();
    expectTypeOf(api.optional).toBeCallableWith(1);
    // @ts-expect-error input is required
    api.double();
    // @ts-expect-error wrong input type
    api.double(1);
  });

  it("types publications", () => {
    expectTypeOf(api.chat.rooms.subscribe()).toEqualTypeOf<SubscriptionHandle>();
    expectTypeOf(api.chat.rooms.collection()).toEqualTypeOf<ClientCollection<Room>>();
    expectTypeOf(api.chat.room.collections("r1").messages).toEqualTypeOf<
      ClientCollection<Message>
    >();
    // @ts-expect-error unknown key
    api.chat.room.collections("r1").nope;
    // @ts-expect-error input is required
    api.chat.room.subscribe();
    // @ts-expect-error input is required
    api.chat.room.collections();
    expectTypeOf(
      api.chat.rooms.subscribe({ onReady: () => {} }),
    ).toEqualTypeOf<SubscriptionHandle>();
    expectTypeOf(
      api.chat.rooms.subscribe(undefined, { onStop: () => {} }),
    ).toEqualTypeOf<SubscriptionHandle>();
    expectTypeOf(
      api.chat.room.subscribe("r1", { onReady: () => {} }),
    ).toEqualTypeOf<SubscriptionHandle>();
  });
});

describe("React client", () => {
  const api = createClient<Server>();

  it("types query hooks", () => {
    expectTypeOf(api.ping.useQuery()).toEqualTypeOf<UseQueryResult<"pong", Error>>();
    expectTypeOf(api.double.useSuspenseQuery("1")).toEqualTypeOf<
      UseSuspenseQueryResult<number, Error>
    >();
    const selected = api.double.useQuery("1", { select: (n) => String(n) });
    expectTypeOf(selected.data).toEqualTypeOf<string | undefined>();
  });

  it("types mutations, with optional variables for void input", () => {
    const ping = api.ping.useMutation();
    expectTypeOf(ping).toEqualTypeOf<UseMutationResult<"pong", Error, void, unknown>>();
    ping.mutate();
    const send = api.chat.messages.send.useMutation();
    send.mutate({ text: "hi" });
    // @ts-expect-error variables are required
    send.mutate();
  });

  it("types query keys and options", () => {
    expectTypeOf(api.double.queryKey("1")).toEqualTypeOf<
      readonly [name: string] | readonly [name: string, input: unknown]
    >();
    expectTypeOf(api.double.queryOptions("1").queryFn).returns.toEqualTypeOf<Promise<number>>();
  });

  it("types publication hooks", () => {
    const rooms = api.chat.rooms.usePublication();
    expectTypeOf(rooms.data).toEqualTypeOf<Room[]>();
    const room = api.chat.room.usePublication("r1");
    expectTypeOf(room.data.messages).toEqualTypeOf<Message[]>();
    expectTypeOf(room.collections.room).toEqualTypeOf<ClientCollection<Room>>();
  });
});

describe("server builder", () => {
  it("types this and context in resolvers", () => {
    createModule()
      .addMethod("m", z.void(), function (_input, context) {
        expectTypeOf(this.userId).toEqualTypeOf<string | null>();
        expectTypeOf(context).toEqualTypeOf<MethodContext>();
      })
      .addPublication("p", z.void(), function (_input, context) {
        expectTypeOf(this).toEqualTypeOf<Subscription>();
        expectTypeOf(context).toEqualTypeOf<PublicationContext>();
      });
  });

  it("types hooks with the parsed input and result", () => {
    createModule().addMethod("m", z.string().transform(Number), (n) => n > 0, {
      hooks: {
        onBeforeResolve: [({ parsed }) => expectTypeOf(parsed).toEqualTypeOf<number>()],
        onAfterResolve: [({ result }) => expectTypeOf(result).toEqualTypeOf<boolean>()],
        onErrorResolve: [
          ({ parsed, error }) => {
            expectTypeOf(parsed).toEqualTypeOf<number | undefined>();
            expectTypeOf(error).toEqualTypeOf<unknown>();
          },
        ],
      },
    });
  });

  it("rejects invalid names at compile time", () => {
    const base = createModule().addMethod("taken", z.void(), () => null);
    // @ts-expect-error duplicate name
    base.addMethod("taken", z.void(), () => null);
    // @ts-expect-error dots are not allowed
    base.addMethod("a.b", z.void(), () => null);
    // @ts-expect-error reserved hook-like name
    base.addMethod("useThing", z.void(), () => null);
    // @ts-expect-error reserved helper name
    base.addMethod("subscribe", z.void(), () => null);
    // @ts-expect-error reserved $ prefix
    base.addMethod("$thing", z.void(), () => null);
    base.addMethod("user", z.void(), () => null);
  });

  it("only builds root modules, only nests namespaced ones", () => {
    // @ts-expect-error build() is only for the root module
    createModule("ns").build();
    // @ts-expect-error buildSubmodule() needs a namespace
    createModule().buildSubmodule();
  });

  it("rejects publications that don't return cursors", () => {
    // @ts-expect-error must return a cursor or nothing
    createModule().addPublication("p", z.void(), () => "nope");
    // @ts-expect-error must return a record of cursors
    createModule().addSharedPublication("p", z.void(), () => [Rooms.find()]);
  });
});
