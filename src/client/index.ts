import type { ConnectionLike } from "../meteor/types.js";
import type { Client } from "../shared/types.js";
import { coreHelpers } from "./helpers.js";
import { createProxy } from "./proxy.js";
import { createTransport } from "./transport.js";

export type {
  ClientCollection,
  ClientCursor,
  ConnectionLike,
  FindOptions,
  MeteorErrorLike,
  Selector,
  SubscribeCallbacks,
  SubscriptionHandle,
} from "../meteor/types.js";
export {
  isMeteorError,
  isValidationError,
  VALIDATION_ERROR,
  type ValidationError,
  type ValidationIssue,
} from "../shared/errors.js";
export type {
  Client,
  CursorPublicationClient,
  InputArgs,
  MethodCaller,
  RecordPublicationClient,
} from "../shared/types.js";

export interface ClientOptions {
  /**
   * DDP connection to use, e.g. `DDP.connect("https://other-app.example.com")`.
   * Defaults to the app's own connection.
   */
  connection?: ConnectionLike | undefined;
}

/**
 * Creates the typed client, without React hooks. Import the server type only:
 *
 * ```ts
 * import type { Server } from "/imports/api/server";
 * export const api = createClient<Server>();
 * ```
 */
export function createClient<TRouter>(options?: ClientOptions): Client<TRouter> {
  return createProxy(createTransport(options?.connection), coreHelpers) as Client<TRouter>;
}
