import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
import type { ClientCollection } from "../meteor/types.js";
import type {
  CursorPublicationClient,
  InputArgs,
  MethodCaller,
  MethodDefinition,
  PublicationDefinition,
  RecordCollections,
  RecordPublicationClient,
} from "../shared/types.js";

/** Query key of a method: `[name]` (matches every input) or `[name, input]`. */
export type MethodQueryKey = readonly [name: string] | readonly [name: string, input: unknown];

/** Mutation key of a method: `[name]`. */
export type MethodMutationKey = readonly [name: string];

/** Variables of `useMutation`: optional when the schema accepts `undefined`. */
export type MutationVariables<TInput> = undefined extends TInput ? TInput | void : TInput;

/**
 * `data` of a query hook: what `select` returns, or the method's result. `ReturnType<typeof
 * api.x.useQuery>` instantiates `TData` as `unknown`, so it reads as the method's result too.
 */
export type QueryData<TResult, TData> = unknown extends TData ? TResult : TData;

export type QueryOptionsFor<TResult, TData = TResult> = Omit<
  UseQueryOptions<TResult, Error, TData, MethodQueryKey>,
  "queryKey" | "queryFn"
>;

export type SuspenseQueryOptionsFor<TResult, TData = TResult> = Omit<
  UseSuspenseQueryOptions<TResult, Error, TData, MethodQueryKey>,
  "queryKey" | "queryFn"
>;

export type MutationOptionsFor<TInput, TResult, TContext = unknown> = Omit<
  UseMutationOptions<TResult, Error, MutationVariables<TInput>, TContext>,
  "mutationFn"
>;

export interface ReactMethodClient<TInput, TResult> extends MethodCaller<TInput, TResult> {
  /** TanStack Query `useQuery` for this method. Doesn't suspend. */
  useQuery<TData = TResult>(
    ...args: [...InputArgs<TInput>, options?: QueryOptionsFor<TResult, TData>]
  ): UseQueryResult<QueryData<TResult, TData>, Error>;
  /** TanStack Query `useSuspenseQuery` for this method. Needs a `<Suspense>` boundary. */
  useSuspenseQuery<TData = TResult>(
    ...args: [...InputArgs<TInput>, options?: SuspenseQueryOptionsFor<TResult, TData>]
  ): UseSuspenseQueryResult<QueryData<TResult, TData>, Error>;
  /** TanStack Query `useMutation` for this method. */
  useMutation<TContext = unknown>(
    options?: MutationOptionsFor<TInput, TResult, TContext>,
  ): UseMutationResult<TResult, Error, MutationVariables<TInput>, TContext>;
  /** The query key used by `useQuery`. Without input it matches every input (for invalidation). */
  queryKey(input?: TInput): MethodQueryKey;
  /** Options for any TanStack Query API: `useQuery`, `prefetchQuery`, `ensureQueryData`, ... */
  queryOptions(
    ...args: [...InputArgs<TInput>, options?: QueryOptionsFor<TResult>]
  ): QueryOptionsFor<TResult> & {
    queryKey: MethodQueryKey;
    queryFn: () => Promise<TResult>;
  };
  /** Options for `useMutation` or `queryClient.getMutationCache()` based APIs. */
  mutationOptions<TContext = unknown>(
    options?: MutationOptionsFor<TInput, TResult, TContext>,
  ): MutationOptionsFor<TInput, TResult, TContext> & {
    mutationKey: MethodMutationKey;
    mutationFn: (input: MutationVariables<TInput>) => Promise<TResult>;
  };
}

export interface CursorPublicationResult<TDoc> {
  /** Documents of this publication, updated live. */
  readonly data: TDoc[];
  /** The client collection holding them. */
  readonly collection: ClientCollection<TDoc>;
}

export interface RecordPublicationResult<TDocs> {
  /** Documents per key, updated live. Missing keys read as `[]`. */
  readonly data: { readonly [K in keyof TDocs]: TDocs[K][] };
  /** The client collection of each key. */
  readonly collections: RecordCollections<TDocs>;
}

export interface ReactCursorPublicationClient<TInput, TDoc>
  extends CursorPublicationClient<TInput, TDoc> {
  /** Subscribes (suspending until ready) and returns the live documents. */
  usePublication(...args: InputArgs<TInput>): CursorPublicationResult<TDoc>;
}

export interface ReactRecordPublicationClient<TInput, TDocs>
  extends RecordPublicationClient<TInput, TDocs> {
  /** Subscribes (suspending until ready) and returns the live documents of every key. */
  usePublication(...args: InputArgs<TInput>): RecordPublicationResult<TDocs>;
}

/** The typed React client for a router: `createClient<typeof server>()` from `meteor-rpc/react`. */
export type ReactClient<TRouter> = {
  readonly [K in keyof TRouter]: TRouter[K] extends MethodDefinition<infer TTypes>
    ? ReactMethodClient<TTypes["input"], TTypes["result"]>
    : TRouter[K] extends PublicationDefinition<infer TTypes>
      ? TTypes["shape"] extends "record"
        ? ReactRecordPublicationClient<TTypes["input"], TTypes["docs"]>
        : ReactCursorPublicationClient<TTypes["input"], TTypes["docs"]>
      : ReactClient<TRouter[K]>;
};

/** A method of a client created with `{ suspense: true }`: its `useQuery` suspends. */
export interface SuspenseReactMethodClient<TInput, TResult>
  extends MethodCaller<TInput, TResult>,
    Omit<ReactMethodClient<TInput, TResult>, "useQuery"> {
  /**
   * TanStack Query `useSuspenseQuery` for this method, because the client was created with
   * `{ suspense: true }`: `data` is always defined. Needs a `<Suspense>` boundary.
   */
  useQuery<TData = TResult>(
    ...args: [...InputArgs<TInput>, options?: SuspenseQueryOptionsFor<TResult, TData>]
  ): UseSuspenseQueryResult<QueryData<TResult, TData>, Error>;
}

/** The React client created with `createClient<typeof server>({ suspense: true })`: `useQuery` suspends. */
export type SuspenseReactClient<TRouter> = {
  readonly [K in keyof TRouter]: TRouter[K] extends MethodDefinition<infer TTypes>
    ? SuspenseReactMethodClient<TTypes["input"], TTypes["result"]>
    : TRouter[K] extends PublicationDefinition<infer TTypes>
      ? TTypes["shape"] extends "record"
        ? ReactRecordPublicationClient<TTypes["input"], TTypes["docs"]>
        : ReactCursorPublicationClient<TTypes["input"], TTypes["docs"]>
      : SuspenseReactClient<TRouter[K]>;
};
