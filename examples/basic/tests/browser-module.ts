// Test-only procedures the browser tests (react.test.tsx) call to arrange and inspect server
// state. Registered only by tests/server.ts; names live under "browser.".
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import { Messages } from "/imports/api/collections";
import { resetDb } from "./helpers";

/** How many times each `browser.counted` instance ran on the server, by `id`. */
const runs = new Map<string, number>();

const browser = createModule("browser")
  .addMethod("reset", z.void(), async () => {
    await resetDb();
    runs.clear();
  })
  .addMethod("logout", z.void(), async function () {
    await this.setUserId(null);
  })
  // Inserts directly, so tests can add messages without chat.send's rate limit.
  .addMethod(
    "addMessage",
    z.object({ roomId: z.string(), text: z.string(), createdAt: z.date().optional() }),
    ({ roomId, text, createdAt = new Date() }) =>
      Messages.insertAsync({ roomId, text, userId: "server", createdAt }),
  )
  .addMethod("runs", z.string(), (id) => runs.get(id) ?? 0)
  .addPublication("counted", z.object({ id: z.string(), page: z.number() }), ({ id }) => {
    runs.set(id, (runs.get(id) ?? 0) + 1);
    return Messages.find({ roomId: id });
  })
  .buildSubmodule();

export const browserServer = createModule().addSubmodule(browser).build();
export type BrowserServer = typeof browserServer;
