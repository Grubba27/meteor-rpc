import { z } from "zod";
import { Config, ReturnMethod } from "../types";
import { isThenable } from "./utils/isThenable";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
// @ts-ignore
import { Meteor } from "meteor/meteor";
import { runHook } from "./utils/runHook";
import {
  UseMutationOptions,
  UseMutationResult,
  UseSuspenseQueryOptions,
  UseSuspenseQueryResult,
  useMutation as useMutationRQ,
} from "@tanstack/react-query";
import { useSuspenseQuery } from "@tanstack/react-query";

/**
 * Creates a method that can be called from the client, or from the server
 * @param name {string} name of the method similar to the name of Meteor.method
 * @param schema Zod schema to validate the arguments
 * @param resolver resolver function to run the method
 * @param config config object to set the rate limit and hooks
 */
export const createMethod = <
  Name extends string,
  Schema extends z.ZodUndefined | z.ZodTypeAny,
  Result
>(
  name: Name,
  schema: Schema,
  resolver?: (args: z.input<Schema>) => Result,
  config?: Config<z.input<Schema>, Result>
) => {
  const hooks = {
    onBeforeResolve: config?.hooks?.onBeforeResolve || [],
    onAfterResolve: config?.hooks?.onAfterResolve || [],
    onErrorResolve: config?.hooks?.onErrorResolve || [],
  };
  if (Meteor.isServer) {
    Meteor.methods({
      async [name](data: unknown) {
        let parsed: z.output<Schema>;
        try {
          parsed = schema.parse(data);
          await runHook(hooks.onBeforeResolve, data, parsed);

          if (resolver === undefined) {
            throw new Error(
              `Method ${name} is not implemented please provide the resolver function or use setResolver`
            );
          }

          const result: Result = resolver(parsed);
          if (isThenable(result)) {
            result
              .then((res) => {
                runHook(hooks.onAfterResolve, data, parsed, res);
              })
              .catch((e) => e);
          } else runHook(hooks.onAfterResolve, data, parsed, result);
          return await result;
        } catch (e: Meteor.Error | Error | unknown) {
          if (!hooks.onErrorResolve.length) {
            // @ts-ignore
            return { __isError__: true, error: e.error, reason: e.reason };
          }
          // @ts-ignore
          await runHook(hooks.onErrorResolve, e, data, parsed);
        }
      },
    });
    if (config?.rateLimit) {
      RateLimiterConfig("method", name, config.rateLimit);
    }
  }

  function call(args?: z.input<Schema>): Promise<Result> {
    // @ts-ignore
    return Meteor.callAsync(name, args);
  }

  /**
   * Runs before the resolver function with the given arguments
   * @function
   */
  call.addBeforeResolveHook = (
    fn: (raw: unknown, parsed: z.input<Schema>) => void
  ) => {
    hooks.onBeforeResolve.push(fn);
  };

  /**
   * Runs after the resolver function with the given arguments and result
   * @function
   */
  call.addAfterResolveHook = (
    fn: (raw: unknown, parsed: z.input<Schema>, result: Result) => void
  ) => {
    hooks.onAfterResolve.push(fn);
  };

  /**
   * Runs when the resolver function throws an error with the given arguments and error
   * @function
   */
  call.addErrorResolveHook = (
    fn: (
      err: Meteor.Error | Error | unknown,
      raw: unknown,
      parsed: z.input<Schema>
    ) => void
  ) => {
    hooks.onErrorResolve.push(fn);
  };

  /**
   * Sets the resolver function. It can be used if you do not want to bundle your backend code with the client
   * @function
   */
  call.setResolver = (newResolver: (args: z.input<Schema>) => Result) => {
    resolver = newResolver;
  };

  call.config = { ...config, name, schema };

  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  // @ts-ignore
  call.expect = <T extends Result, SchemaResult extends Result = Result>(
    // @ts-ignore
    expectedSchema?: SchemaResult
  ): ReturnMethod<Name, Schema, Result> => {
    return call as ReturnMethod<Name, Schema, Result>;
  };

  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  // @ts-ignore
  call.returns = <T extends Result, SchemaResult extends Result = Result>(
    // @ts-ignore
    expectedSchema?: SchemaResult
  ): ReturnMethod<Name, Schema, Result> => {
    return call as ReturnMethod<Name, Schema, Result>;
  };
  /**
   * Creates a react-query useMutation hook using the context for the method
   * @returns {UseMutationResult<Result, Error, z.input<Schema>>} react-query useMutation hook
   */
  call.useMutation = (
    options?: UseMutationOptions<Result, Error, z.input<Schema>, unknown>
  ): UseMutationResult<Result, Error, z.input<Schema>> => {
    return useMutationRQ({
      ...options,
      mutationFn: (params) => call(params),
    });
  };

  /**
   * Creates a react-query useQuery hook using the context for the method
   * @param {[z.input<Schema>]} Args that comes from schema
   * @param {{useQueryOptions: UseSuspenseQueryOptions<Result, Error, Awaited<Result>, (z.input<Schema> | Name | undefined)[]>}} UseQueryOptions Options for react-query useQuery hook
   * @returns{UseSuspenseQueryResult<Result, Error>} react-query useQuery hook
   */
  call.useQuery = (
    args?: z.input<Schema>,
    {
      useQueryOptions,
    }: {
      useQueryOptions?: UseSuspenseQueryOptions<
        Result,
        Error,
        Awaited<Result>,
        (z.input<Schema> | Name | undefined)[]
      >;
    } = {}
  ): UseSuspenseQueryResult<Awaited<Result>, Error> => {
    return useSuspenseQuery({
      ...useQueryOptions,
      queryFn: () => call(args),
      queryKey: [call.config.name, args],
    });
  };

  return call as ReturnMethod<Name, Schema, Result>;
};

export const createMutation = createMethod;
export const createQuery = createMethod;
