import type { ClientOptions } from "../client/index.js";
import { createProxy } from "../client/proxy.js";
import { createTransport } from "../client/transport.js";
import { reactHelpers } from "./helpers.js";
import type { ReactClient } from "./types.js";

export {
  type Client,
  type ClientCollection,
  type ClientCursor,
  type ClientOptions,
  type ConnectionLike,
  type CursorPublicationClient,
  type FindOptions,
  type InputArgs,
  isMeteorError,
  isValidationError,
  type MeteorErrorLike,
  type MethodCaller,
  type RecordPublicationClient,
  type Selector,
  type SubscribeCallbacks,
  type SubscriptionHandle,
  VALIDATION_ERROR,
  type ValidationError,
  type ValidationIssue,
} from "../client/index.js";
export type {
  CursorPublicationResult,
  MethodMutationKey,
  MethodQueryKey,
  MutationOptionsFor,
  MutationVariables,
  QueryOptionsFor,
  ReactClient,
  ReactCursorPublicationClient,
  ReactMethodClient,
  ReactRecordPublicationClient,
  RecordPublicationResult,
  SuspenseQueryOptionsFor,
} from "./types.js";

/**
 * Creates the typed client with React hooks (TanStack Query + publications).
 * Create it once, e.g. in `imports/api/client.ts`, and import the server type only:
 *
 * ```ts
 * import type { Server } from "/imports/api/server";
 * export const api = createClient<Server>();
 * ```
 */
export function createClient<TRouter>(options?: ClientOptions): ReactClient<TRouter> {
  return createProxy(createTransport(options?.connection), reactHelpers) as ReactClient<TRouter>;
}
