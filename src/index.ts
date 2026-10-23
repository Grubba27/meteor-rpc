// The root entry keeps v1-style imports working: `import { createModule, createClient } from "meteor-rpc"`.
// It needs React and TanStack Query. Without React, import from "meteor-rpc/server" and "meteor-rpc/client".
export * from "./react/index.js";
export * from "./server/index.js";
