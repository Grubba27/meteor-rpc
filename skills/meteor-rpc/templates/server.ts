// The root module. Copy to imports/api/server.ts and import it from server/main.ts:
//   import "/imports/api/server";
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import { tasks } from "./tasks";

const server = createModule() // the root: no namespace
  .addMethod("ping", z.void(), () => "pong" as const)
  .addSubmodule(tasks)
  .build(); // registers every method and publication; only the root calls it, once

export type Server = typeof server; // the client is typed from this
