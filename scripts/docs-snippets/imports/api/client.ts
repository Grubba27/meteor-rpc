// Default for docs that import "/imports/api/client" without showing it.
import { createClient } from "meteor-rpc/react";
import type { Server } from "./server";

export const api = createClient<Server>();
