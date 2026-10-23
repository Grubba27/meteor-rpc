// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { createModule } from "meteor-rpc";
import { z } from "zod";
import { audit, auditLog, checkAccess, rateLog } from "./helpers";
import { Todos } from "./todos";

// Not passed inline, so its parameter types are kept.
const withAudit = {
  hooks: {
    onAfterResolve: [
      (raw: unknown, parsed: string, result: number) =>
        auditLog.write("todos.remove", raw, parsed, result),
    ],
  },
};

export const todos = createModule("todos")
  .addMiddlewares([
    // Runs for every method and publication.
    (raw, parsed) => console.log("todos", raw, parsed),
    function (r) {
      checkAccess(this.userId, r);
    },
    rateLog,
    (...args) => console.log(args),
  ])
  .addMethod("add", z.string(), (text) => Todos.insertAsync({ text }), {
    rateLimit: { limit: 5, interval: 1000 },
    hooks: {
      onBeforeResolve: [(_raw, { length }: string) => console.log(length)],
      onAfterResolve: [(raw, parsed, result) => audit(raw, parsed, result)],
      onErrorResolve: [(err, raw, parsed) => console.error(err, raw, parsed)],
    },
  })
  .addMethod("remove", z.string(), (id) => Todos.removeAsync(id), withAudit)
  .addPublication("list", z.void(), () => Todos.find(), {
    hooks: {
      onBeforeResolve: [(raw: unknown) => console.log(raw), async () => {}],
      onAfterResolve: [(raw, parsed, cursor, extra) => console.log(raw, parsed, cursor, extra)],
      onErrorResolve: [
        (error) => console.error(error),
        (err, raw = null) => console.error(err, raw),
      ],
    },
  })
  .buildSubmodule();
