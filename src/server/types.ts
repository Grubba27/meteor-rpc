import type { AnySchema, InferInput, InferOutput } from "../shared/schema.js";
import type {
  CheckName,
  CursorDocs,
  CursorResult,
  MethodConfig,
  MethodDefinition,
  MethodResolver,
  Middleware,
  PublicationConfig,
  PublicationDefinition,
  PublicationResolver,
  RecordDocs,
  RecordResult,
  Router,
  Submodule,
} from "../shared/types.js";

/**
 * The builder returned by `createModule()`. Every `add*` call returns a new builder;
 * nothing is registered with Meteor until `build()` runs.
 *
 * Declared as an explicit interface (instead of an inferred type) so the published
 * `.d.ts` stays small and the compiler never hits TS7056.
 */
export interface ModuleBuilder<TPrefix extends string | undefined, TRecord> {
  /** Type-only marker for the module namespace. Never set at runtime. */
  readonly "~prefix": TPrefix;

  /**
   * Adds a method. The client calls it with the schema's input type and gets the resolver's
   * (awaited) return type back.
   *
   * @param name Method name. Namespaces come from `createModule("namespace")`.
   * @param schema Any Standard Schema (zod, valibot, arktype, ...). Use `z.void()` for no input.
   * @param resolver Runs on the server with the validated input. `this` is Meteor's method invocation.
   * @param config Rate limit and hooks.
   */
  addMethod<TName extends string, TSchema extends AnySchema, TResult>(
    name: CheckName<TName, keyof TRecord>,
    schema: TSchema,
    resolver: MethodResolver<InferOutput<TSchema>, TResult>,
    config?: MethodConfig<InferOutput<TSchema>, Awaited<TResult>>,
  ): ModuleBuilder<
    TPrefix,
    TRecord & {
      readonly [K in TName]: MethodDefinition<{
        readonly input: InferInput<TSchema>;
        readonly result: Awaited<TResult>;
      }>;
    }
  >;

  /**
   * Adds a publication that returns one cursor (or nothing). On the client the documents
   * land in a collection of their own, read with `usePublication()` or `collection()`.
   */
  addPublication<TName extends string, TSchema extends AnySchema, TResult extends CursorResult>(
    name: CheckName<TName, keyof TRecord>,
    schema: TSchema,
    resolver: PublicationResolver<InferOutput<TSchema>, TResult>,
    config?: PublicationConfig<InferOutput<TSchema>, Awaited<TResult>>,
  ): ModuleBuilder<
    TPrefix,
    TRecord & {
      readonly [K in TName]: PublicationDefinition<{
        readonly input: InferInput<TSchema>;
        readonly shape: "cursor";
        readonly docs: CursorDocs<TResult>;
      }>;
    }
  >;

  /**
   * Adds a publication that returns several named cursors, e.g. `{ rooms: Rooms.find(), users: Users.find() }`.
   * Each key gets its own client collection, so documents from different collections never mix.
   */
  addSharedPublication<
    TName extends string,
    TSchema extends AnySchema,
    TResult extends RecordResult,
  >(
    name: CheckName<TName, keyof TRecord>,
    schema: TSchema,
    resolver: PublicationResolver<InferOutput<TSchema>, TResult>,
    config?: PublicationConfig<InferOutput<TSchema>, Awaited<TResult>>,
  ): ModuleBuilder<
    TPrefix,
    TRecord & {
      readonly [K in TName]: PublicationDefinition<{
        readonly input: InferInput<TSchema>;
        readonly shape: "record";
        readonly docs: RecordDocs<TResult>;
      }>;
    }
  >;

  /** Nests a module built with `createModule("namespace")...buildSubmodule()`. */
  addSubmodule<TName extends string, TSubRecord>(
    submodule: Submodule<TName, TSubRecord>,
  ): ModuleBuilder<TPrefix, TRecord & { readonly [K in TName]: Router<TSubRecord> }>;

  /**
   * Adds middlewares for every method and publication of this module and its submodules.
   * They run after validation, outer module first, in the order they were added.
   */
  addMiddlewares(middlewares: ReadonlyArray<Middleware>): ModuleBuilder<TPrefix, TRecord>;

  /**
   * Registers every method and publication with Meteor (on the server) and returns the router.
   * Only for the root module: `createModule()` without a namespace. Calling it again returns
   * the same router without registering twice.
   */
  build(this: { readonly "~prefix": undefined }): Router<TRecord>;

  /** Finishes a namespaced module so it can be passed to `addSubmodule`. Registers nothing. */
  buildSubmodule(this: { readonly "~prefix": string }): Submodule<
    TPrefix extends string ? TPrefix : never,
    TRecord
  >;
}
