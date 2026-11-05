// Public types shared by the server builder and the clients.
// Everything exported here is part of the semver contract (see CONTRIBUTING.md).

import type {
  ClientCollection,
  ConnectionInfo,
  CursorLike,
  MethodInvocation,
  SubscribeCallbacks,
  Subscription,
  SubscriptionHandle,
} from "../meteor/types.js";
import type { ReservedName } from "./names.js";

export type MaybePromise<T> = T | Promise<T>;

// ---------------------------------------------------------------------------
// Contexts passed to resolvers, middlewares and hooks
// ---------------------------------------------------------------------------

interface BaseContext {
  /** Full DDP name, including namespaces, e.g. `"chat.createChat"`. */
  readonly name: string;
  readonly userId: string | null;
  readonly connection: ConnectionInfo | null;
}

/** Second argument of every method resolver. */
export interface MethodContext extends BaseContext {
  readonly type: "method";
  /** Meteor's method invocation (the resolver's `this`). */
  readonly invocation: MethodInvocation;
}

/** Second argument of every publication resolver. */
export interface PublicationContext extends BaseContext {
  readonly type: "publication";
  /** Meteor's subscription (the resolver's `this`). */
  readonly subscription: Subscription;
}

export type RpcContext = MethodContext | PublicationContext;

/** Argument of a middleware. Runs after validation, before hooks and the resolver. */
export type MiddlewareContext = RpcContext & {
  /** Input exactly as the client sent it. */
  readonly raw: unknown;
  /** Input after schema validation. */
  readonly parsed: unknown;
};

/** Runs for every method and publication of a module and its submodules. May be async; throw to reject the call. */
export type Middleware = (context: MiddlewareContext) => unknown;

export type BeforeResolveContext<TContext extends RpcContext, TParsed> = TContext & {
  readonly raw: unknown;
  readonly parsed: TParsed;
};

export type AfterResolveContext<TContext extends RpcContext, TParsed, TResult> = TContext & {
  readonly raw: unknown;
  readonly parsed: TParsed;
  readonly result: TResult;
};

export type ErrorResolveContext<TContext extends RpcContext, TParsed> = TContext & {
  readonly raw: unknown;
  /** `undefined` when validation itself failed. */
  readonly parsed: TParsed | undefined;
  readonly error: unknown;
};

export interface Hooks<TContext extends RpcContext, TParsed, TResult> {
  /** Run in order after middlewares, before the resolver. Throw to reject the call. */
  onBeforeResolve?:
    | ReadonlyArray<(context: BeforeResolveContext<TContext, TParsed>) => unknown>
    | undefined;
  /** Run in order after the resolver succeeded. */
  onAfterResolve?:
    | ReadonlyArray<(context: AfterResolveContext<TContext, TParsed, TResult>) => unknown>
    | undefined;
  /** Run in order when anything failed. The error is re-thrown to the caller afterwards. */
  onErrorResolve?:
    | ReadonlyArray<(context: ErrorResolveContext<TContext, TParsed>) => unknown>
    | undefined;
}

/** Allow at most `limit` calls per `interval` milliseconds, per connection. Needs `meteor add ddp-rate-limiter`. */
export interface RateLimit {
  readonly limit: number;
  readonly interval: number;
}

export interface MethodConfig<TParsed, TResult> {
  rateLimit?: RateLimit | undefined;
  hooks?: Hooks<MethodContext, TParsed, TResult> | undefined;
}

export interface PublicationConfig<TParsed, TResult> {
  rateLimit?: RateLimit | undefined;
  hooks?: Hooks<PublicationContext, TParsed, TResult> | undefined;
}

export type MethodResolver<TParsed, TResult> = (
  this: MethodInvocation,
  input: TParsed,
  context: MethodContext,
) => TResult;

export type PublicationResolver<TParsed, TResult> = (
  this: Subscription,
  input: TParsed,
  context: PublicationContext,
) => TResult;

/** What a publication resolver may return: a cursor, or nothing (e.g. when unauthorized). */
export type CursorResult = MaybePromise<CursorLike<unknown> | null | undefined | void>;

/** What a shared publication resolver may return: named cursors, or nothing. */
export type RecordResult = MaybePromise<
  Readonly<Record<string, CursorLike<unknown> | null | undefined>> | null | undefined | void
>;

// ---------------------------------------------------------------------------
// Definitions: what `build()` returns. `typeof server` drives the client types.
// ---------------------------------------------------------------------------

export interface MethodTypes {
  readonly input: unknown;
  readonly result: unknown;
}

export interface MethodDefinition<TTypes extends MethodTypes = MethodTypes> {
  readonly type: "method";
  /** Type-only marker. Never set at runtime. */
  readonly "~types": TTypes;
}

export interface PublicationTypes {
  readonly input: unknown;
  readonly shape: "cursor" | "record";
  /** The document type (`cursor`), or a record of document types (`record`). */
  readonly docs: unknown;
}

export interface PublicationDefinition<TTypes extends PublicationTypes = PublicationTypes> {
  readonly type: "publication";
  /** Type-only marker. Never set at runtime. */
  readonly "~types": TTypes;
}

export type Definition = MethodDefinition<any> | PublicationDefinition<any>;

export interface RouterRecord {
  readonly [name: string]: Definition | RouterRecord;
}

/** The object `build()` returns. Export `typeof server` and pass it to `createClient`. */
export type Router<TRecord> = { readonly [K in keyof TRecord]: TRecord[K] };

/** The object `buildSubmodule()` returns. Pass it to `addSubmodule`. */
export interface Submodule<TName extends string, TRecord> {
  readonly name: TName;
  readonly submodule: Router<TRecord>;
}

type Present<T> = Exclude<Awaited<T>, null | undefined | void>;

/** Document type of a cursor. */
export type CursorDoc<TCursor> = TCursor extends CursorLike<infer TDoc> ? TDoc : never;

/** Document type published by a `addPublication` resolver returning `TResult`. */
export type CursorDocs<TResult> = CursorDoc<Present<TResult>>;

/** Document types published by a `addSharedPublication` resolver returning `TResult`. */
export type RecordDocs<TResult> = {
  readonly [K in keyof Present<TResult>]: CursorDoc<Present<Present<TResult>[K]>>;
};

/**
 * Compile-time version of the runtime name rules: names can't contain dots,
 * can't be reserved, and can't repeat inside one module.
 */
export type CheckName<TName extends string, TExisting> = string extends TName
  ? TName
  : TName extends `${string}.${string}`
    ? `"${TName}" contains a dot; use createModule("namespace") to nest`
    : TName extends ReservedName
      ? `"${TName}" is reserved by meteor-rpc`
      : TName extends TExisting
        ? `"${TName}" is already defined in this module`
        : TName;

// ---------------------------------------------------------------------------
// Client types
// ---------------------------------------------------------------------------

/** Parameters for sending `TInput`: optional when the schema accepts `undefined`. */
export type InputArgs<TInput> = undefined extends TInput ? [input?: TInput] : [input: TInput];

export type MethodCaller<TInput, TResult> = (...args: InputArgs<TInput>) => Promise<TResult>;

/** `subscribe` of a publication: the input is optional (and callbacks may come first) when the schema accepts `undefined`. */
export type SubscribeFunction<TInput> = undefined extends TInput
  ? {
      (callbacks?: SubscribeCallbacks): SubscriptionHandle;
      (input: TInput, callbacks?: SubscribeCallbacks): SubscriptionHandle;
    }
  : (input: TInput, callbacks?: SubscribeCallbacks) => SubscriptionHandle;

/** Client collections of a shared publication instance, by key. */
export type RecordCollections<TDocs> = {
  readonly [K in keyof TDocs]: ClientCollection<TDocs[K]>;
};

export interface CursorPublicationClient<TInput, TDoc> {
  /** Subscribe without React. Read the data with `collection(input)`. */
  readonly subscribe: SubscribeFunction<TInput>;
  /** Client collection holding the documents published for this input. */
  collection(...args: InputArgs<TInput>): ClientCollection<TDoc>;
}

export interface RecordPublicationClient<TInput, TDocs> {
  /** Subscribe without React. Read the data with `collections(input)`. */
  readonly subscribe: SubscribeFunction<TInput>;
  /** Client collections holding the documents published for this input, by key. */
  collections(...args: InputArgs<TInput>): RecordCollections<TDocs>;
}

/** The typed client for a router: `createClient<typeof server>()` from `meteor-rpc/client`. */
export type Client<TRouter> = {
  readonly [K in keyof TRouter]: TRouter[K] extends MethodDefinition<infer TTypes>
    ? MethodCaller<TTypes["input"], TTypes["result"]>
    : TRouter[K] extends PublicationDefinition<infer TTypes>
      ? TTypes["shape"] extends "record"
        ? RecordPublicationClient<TTypes["input"], TTypes["docs"]>
        : CursorPublicationClient<TTypes["input"], TTypes["docs"]>
      : Client<TRouter[K]>;
};

/**
 * The methods of a router, for server code: `createCaller(module)` from `meteor-rpc/server`.
 * Publications are left out: subscribing needs a client connection.
 */
export type Caller<TRouter> = {
  readonly [K in keyof TRouter as TRouter[K] extends PublicationDefinition<any>
    ? never
    : K]: TRouter[K] extends MethodDefinition<infer TTypes>
    ? MethodCaller<TTypes["input"], TTypes["result"]>
    : Caller<TRouter[K]>;
};
