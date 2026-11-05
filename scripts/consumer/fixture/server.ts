// Server side of the consumer fixture: every builder API, with type assertions.
import {
  type ConnectionInfo,
  createModule,
  type MethodContext,
  type MethodInvocation,
  type MiddlewareContext,
  type PublicationContext,
  type Subscription,
} from "meteor-rpc/server";
import { type Member, Members, type Message, Messages, notAuthorized, Rooms } from "./db.js";
import { assert, type Equal, type Same } from "./expect.js";
import { lengthOf, noInput, optionalPage, roomFilter, roomId, sendInput } from "./schemas.js";

type SendInput = { roomId: string; text: string };
type SendResult = { id: string; at: Date };

const chat = createModule("chat")
  .addMiddlewares([
    (context) => {
      assert<Equal<typeof context, MiddlewareContext>>();
      assert<Equal<typeof context.userId, string | null>>();
      assert<Equal<typeof context.type, "method" | "publication">>();
      assert<Equal<typeof context.raw, unknown>>();
      if (context.type === "method") {
        assert<Equal<typeof context.invocation, MethodInvocation>>();
      } else {
        assert<Equal<typeof context.subscription, Subscription>>();
      }
      if (!context.userId) throw notAuthorized();
    },
    async ({ name }) => {
      assert<Equal<typeof name, string>>();
    },
  ])
  .addMethod(
    "send",
    sendInput,
    async function (input, context) {
      assert<Same<typeof input, SendInput>>();
      assert<Equal<typeof context, MethodContext>>();
      assert<Equal<typeof this, MethodInvocation>>();
      assert<Equal<typeof context.connection, ConnectionInfo | null>>();
      this.unblock();
      return { id: `${input.roomId}:${context.userId ?? "anonymous"}`, at: new Date() };
    },
    {
      rateLimit: { limit: 5, interval: 1000 },
      hooks: {
        onBeforeResolve: [
          (context) => {
            assert<Same<typeof context.parsed, SendInput>>();
            assert<Equal<typeof context.type, "method">>();
          },
        ],
        onAfterResolve: [
          async (context) => {
            assert<Equal<typeof context.result, SendResult>>();
          },
        ],
        onErrorResolve: [
          (context) => {
            assert<Same<typeof context.parsed, SendInput | undefined>>();
            assert<Equal<typeof context.error, unknown>>();
          },
        ],
      },
    },
  )
  .addMethod("length", lengthOf, (length) => {
    assert<Equal<typeof length, number>>();
    return length * 2;
  })
  .addPublication(
    "messages",
    roomFilter,
    function ({ roomId }, context) {
      assert<Equal<typeof context, PublicationContext>>();
      assert<Equal<typeof this, Subscription>>();
      this.onStop(() => {});
      if (!this.userId) return;
      return Messages.find({ roomId });
    },
    {
      rateLimit: { limit: 10, interval: 1000 },
      hooks: {
        onBeforeResolve: [
          (context) => {
            assert<Equal<typeof context.type, "publication">>();
          },
        ],
      },
    },
  )
  .addPublication("nothing", noInput, async () => null)
  .addSharedPublication("room", roomId, (id) => {
    assert<Equal<typeof id, string>>();
    return { room: Rooms.find({ _id: id }), members: Members.find({ roomId: id }) };
  })
  .buildSubmodule();

const inner = createModule("inner")
  .addMethod("deep", noInput, () => "deep" as const)
  .buildSubmodule();
const outer = createModule("outer").addSubmodule(inner).buildSubmodule();

export const server = createModule()
  .addMiddlewares([() => {}])
  .addMethod("ping", noInput, () => "pong" as const)
  .addMethod("page", optionalPage, (page) => page?.page ?? 0)
  .addSubmodule(chat)
  .addSubmodule(outer)
  .build();

export type Server = typeof server;
export type { Member, Message };

// ---------------------------------------------------------------------------
// Misuse must not compile. Kept to one short line each so the formatter never
// moves the error away from its @ts-expect-error comment.
// ---------------------------------------------------------------------------

const one = (): number => 1;
const passthrough = { parse: (value: unknown) => value };

export function misuse(): void {
  const root = createModule();
  // @ts-expect-error "subscribe" is reserved by the client proxy
  root.addMethod("subscribe", noInput, one);
  // @ts-expect-error names starting with "use" + uppercase are reserved for hooks
  root.addMethod("useThing", noInput, one);
  // @ts-expect-error "$"-prefixed names are reserved
  root.addMethod("$helper", noInput, one);
  // @ts-expect-error dots are not allowed, nest with createModule("namespace")
  root.addMethod("a.b", noInput, one);
  // @ts-expect-error duplicate name in one module
  root.addMethod("dup", noInput, one).addMethod("dup", noInput, one);
  // @ts-expect-error build() is only for the root module
  createModule("sub").build();
  // @ts-expect-error buildSubmodule() needs a namespace
  root.buildSubmodule();
  // @ts-expect-error publications must return a cursor (or nothing)
  root.addPublication("bad", noInput, one);
  // @ts-expect-error shared publications must return a record of cursors
  root.addSharedPublication("badShared", noInput, () => Messages.find());
  // @ts-expect-error the schema must be a Standard Schema
  root.addMethod("noSchema", passthrough, one);
  // @ts-expect-error the resolver receives the parsed input type
  root.addMethod("typo", sendInput, (input) => input.missing);
  // @ts-expect-error rateLimit needs both limit and interval
  root.addMethod("rl", noInput, one, { rateLimit: { limit: 1 } });
  // @ts-expect-error onAfterResolve receives the awaited result (a number here)
  root.addMethod("hook", noInput, one, { hooks: { onAfterResolve: [(c) => c.result.at] } });
  // @ts-expect-error middlewares must be functions
  root.addMiddlewares([1]);
}
