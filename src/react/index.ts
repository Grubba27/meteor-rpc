import type { ClientOptions } from "../client/index.js";
import { createProxy } from "../client/proxy.js";
import { createTransport } from "../client/transport.js";
import { reactHelpers, suspenseReactHelpers } from "./helpers.js";
import type { ReactClient, SuspenseReactClient } from "./types.js";

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
  QueryData,
  QueryOptionsFor,
  ReactClient,
  ReactCursorPublicationClient,
  ReactMethodClient,
  ReactRecordPublicationClient,
  RecordPublicationResult,
  SuspenseQueryOptionsFor,
  SuspenseReactClient,
  SuspenseReactMethodClient,
} from "./types.js";

/** Options of the React client. */
export interface ReactClientOptions extends ClientOptions {
  /**
   * Makes `useQuery` suspend like `useSuspenseQuery`, so its `data` is always defined. The
   * components need a `<Suspense>` boundary and an error boundary above them.
   */
  suspense?: boolean | undefined;
}

/**
 * Creates the typed client with React hooks (TanStack Query + publications).
 * Create it once, e.g. in `imports/api/client.ts`, and import the server type only:
 *
 * ```ts
 * import type { Server } from "/imports/api/server";
 * export const api = createClient<Server>();
 * ```
 *
 * With `{ suspense: true }`, `useQuery` suspends (it's `useSuspenseQuery`), so `data` is always
 * defined.
 */
export function createClient<TRouter>(
  options: ReactClientOptions & { suspense: true },
): SuspenseReactClient<TRouter>;
export function createClient<TRouter>(
  options?: ReactClientOptions & { suspense?: false | undefined },
): ReactClient<TRouter>;
export function createClient<TRouter>(
  options?: ReactClientOptions,
): ReactClient<TRouter> | SuspenseReactClient<TRouter> {
  const helpers = options?.suspense ? suspenseReactHelpers : reactHelpers;
  return createProxy(createTransport(options?.connection), helpers) as ReactClient<TRouter>;
}
