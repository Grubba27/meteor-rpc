import {
  UseMutationOptions,
  UseMutationResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
} from "@tanstack/react-query";
// @ts-ignore
import { Meteor } from "meteor/meteor";
// @ts-ignore
import { Mongo } from "meteor/mongo";
import { z } from "zod";

type BeforeHook<Schema extends z.ZodUndefined | z.ZodTypeAny> = (
  fn: (raw: unknown, parsed: z.infer<Schema>) => void
) => void;

type AfterHook<Schema extends z.ZodUndefined | z.ZodTypeAny, Result> = (
  fn: (raw: unknown, parsed: z.infer<Schema>, result: Result) => void
) => void;

type ErrorHook<Schema extends z.ZodUndefined | z.ZodTypeAny> = (
  fn: (error: unknown, raw: unknown, parsed: z.infer<Schema>) => void
) => void;

export type Resolver<Schema extends z.ZodUndefined | z.ZodTypeAny, Result> = (
  newResolver: (args: z.input<Schema>) => Result
) => void;

type ReturnMethod<
  Name extends string,
  Schema extends z.ZodUndefined | z.ZodTypeAny,
  Result,
  // @ts-ignore
  UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined
    ? []
    : [z.input<Schema>]
> = {
  config: {
    name: Name;
    schema: Schema;
    __result: Result;
    rateLimit?: {
      interval: number;
      limit: number;
    };
    methodHooks?: {
      onBeforeResolve?: Array<(raw: unknown, parsed: z.input<Schema>) => void>;
      onAfterResolve?: Array<
        (raw: unknown, parsed: z.input<Schema>, result: Result) => void
      >;
      onErrorResolve?: Array<
        (
          err: Meteor.Error | Error | unknown,
          raw: unknown,
          parsed: z.input<Schema>
        ) => void
      >;
    };
  };
  /**
   * Runs before the resolver function with the given arguments
   * @function
   */
  addBeforeResolveHook: BeforeHook<Schema>;
  /**
   * Runs after the resolver function with the given arguments and result
   * @function
   */
  addAfterResolveHook: AfterHook<Schema, Result>;
  /**
   * Runs when the resolver function throws an error with the given arguments and error
   * @function
   */
  addErrorResolveHook: ErrorHook<Schema>;
  /**
   * Sets the resolver function. It can be used if you do not want to bundle your backend code with the client
   * @function
   */
  setResolver: Resolver<Schema, Result>;
  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  expect: <
    T,
    SchemaResult extends z.ZodUndefined | z.ZodTypeAny = z.ZodUndefined
  >(
    newSchema?: SchemaResult
  ) => SchemaResult extends z.ZodUndefined
    ? ReturnMethod<Name, Schema, T>
    : ReturnMethod<Name, Schema, z.infer<SchemaResult>>;

  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  returns: <
    T,
    SchemaResult extends z.ZodUndefined | z.ZodTypeAny = z.ZodUndefined
  >(
    newSchema?: SchemaResult
  ) => SchemaResult extends z.ZodUndefined
    ? ReturnMethod<Name, Schema, T>
    : ReturnMethod<Name, Schema, z.infer<SchemaResult>>;
  /**
   * Creates a react-query useMutation hook using the context for the method
   * @returns {UseMutationResult<Result, Error, z.input<Schema>>} react-query useMutation hook
   */
  useMutation: (
    options?: UseMutationOptions<Result, Error, z.input<Schema>, unknown>
  ) => UseMutationResult<Result, Error, z.input<Schema>>;

  /**
   * Creates a react-query useQuery hook using the context for the method
   * @param {[z.input<Schema>]} Args that comes from schema
   * @param {{useQueryOptions: UseSuspenseQueryOptions<Result, Error, Awaited<Result>, (z.input<Schema> | Name | undefined)[]>}} UseQueryOptions Options for react-query useQuery hook
   *
   * @returns{UseSuspenseQueryResult<Result, Error>} react-query useQuery hook
   */
  useQuery: (
    args?: z.input<Schema>,
    {
      useQueryOptions,
    }?: {
      useQueryOptions?: Omit<
        UseSuspenseQueryOptions<
          Result,
          Error,
          Awaited<Result>,
          (z.input<Schema> | Name | undefined)[]
        >,
        "queryKey" | "queryFn"
      >;
    }
  ) => UseSuspenseQueryResult<Awaited<Result>, Error>;
  <T>(args?: z.input<Schema>): Promise<Result> & Promise<T>;
};

type ReturnSubscription<
  Name extends string,
  Schema extends z.ZodTuple | z.ZodTypeAny,
  Result,
  DBResult extends Mongo.Cursor<Result> = Mongo.Cursor<Result>,
  // @ts-ignore
  UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple
    ? z.infer<Schema>
    : []
> = {
  config: {
    name: Name;
    schema: Schema;
    __result: Result;
    rateLimit?: {
      interval: number;
      limit: number;
    };
    methodHooks?: {
      onBeforeResolve?: Array<
        (args?: unknown, parsed?: z.input<Schema>) => void
      >;
      onAfterResolve?: Array<
        (args?: z.input<Schema>, result?: DBResult) => void
      >;
      onErrorResolve?: Array<
        (
          err?: Meteor.Error | Error | unknown,
          raw?: unknown,
          parsed?: z.input<Schema>
        ) => void
      >;
    };
  };
  /**
   * Runs before the resolver function with the given arguments
   * @function
   */
  addBeforeResolveHook: BeforeHook<Schema>;
  /**
   * Runs after the resolver function with the given arguments and result
   * @function
   */
  addAfterResolveHook: AfterHook<Schema, DBResult>;
  /**
   * Runs when the resolver function throws an error with the given arguments and error
   * @function
   */
  addErrorResolveHook: ErrorHook<Schema>;
  /**
   * Sets the resolver function. It can be used if you do not want to bundle your backend code with the client
   * @function
   */
  setResolver: Resolver<Schema, DBResult>;

  /**
   * Creates a react-query useQuery hook using the context for the method
   */
  usePublication: (args: z.input<Schema>) => {
    data: Result[];
    // @ts-ignore
    collection: Mongo.Collection<Result>;
  };
  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  expect: <
    T,
    SchemaResult extends z.ZodUndefined | z.ZodTypeAny = z.ZodUndefined
  >(
    newSchema?: SchemaResult
  ) => SchemaResult extends z.ZodUndefined
    ? ReturnMethod<Name, Schema, T>
    : ReturnMethod<Name, Schema, z.infer<SchemaResult>>;

  (
    ...args: Schema extends z.ZodUndefined | z.ZodTypeAny
      ? [SubscriptionCallbacks?]
      : [z.input<Schema>, SubscriptionCallbacks?]
  ): Meteor.SubscriptionHandle;
};
type Maybe<T> = T | null | undefined | unknown;
type Config<S, T> = {
  rateLimit?: {
    interval: number;
    limit: number;
  };
  hooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<
      (err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void
    >;
  };
};

interface SubscriptionCallbacks {
  onStop?: (err?: any) => void;
  onReady?: () => void;
}

export { ReturnMethod, ReturnSubscription, Config, SubscriptionCallbacks };
