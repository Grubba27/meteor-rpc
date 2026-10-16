// The root entry re-exports the React client and the server builder (v1-style imports).
import { createClient, createModule, type isValidationError, type ReactClient } from "meteor-rpc";
import type * as client from "meteor-rpc/client";
import type * as react from "meteor-rpc/react";
import type * as server from "meteor-rpc/server";
import { assert, type Equal } from "./expect.js";
import { noInput } from "./schemas.js";
import type { Server } from "./server.js";

assert<Equal<typeof createModule, typeof server.createModule>>();
assert<Equal<typeof createClient, typeof react.createClient>>();
assert<Equal<typeof isValidationError, typeof client.isValidationError>>();

const tiny = createModule()
  .addMethod("hello", noInput, () => "world" as const)
  .build();
export const tinyApi: ReactClient<typeof tiny> = createClient<typeof tiny>();
export const rootApi: ReactClient<Server> = createClient<Server>();
