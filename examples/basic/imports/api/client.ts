// The typed client. `import type` keeps every server module out of the client bundle.
import { createClient } from "meteor-rpc/react";
import type { Server } from "./server";

export const api = createClient<Server>();
