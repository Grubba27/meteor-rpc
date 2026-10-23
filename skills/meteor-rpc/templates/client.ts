// The app's only client. Copy to imports/api/client.ts; components import `api` from here.
import { createClient } from "meteor-rpc/react"; // "meteor-rpc/client" for code without React
import type { Server } from "./server"; // type-only: no server code reaches the client bundle

export const api = createClient<Server>();
