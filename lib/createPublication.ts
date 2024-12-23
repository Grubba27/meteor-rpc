import { Config, ReturnSubscription, SubscriptionCallbacks } from "../types";
import { z } from "zod";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
// @ts-ignore
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";
import { runHook } from "./utils/runHook";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useSubscribe } from "./utils/hooks/useSubscribe";
import { useFind } from "./utils/hooks/useFind";
// @ts-ignore
import { Mongo } from "meteor/mongo";

// doc this method
let cachedCollectionsNames: Record<string, string> = {};
/**
 * Creates a publication that can be called from the client, or from the server
 * @param name {string} name of the method similar to the name of Meteor.publish
 * @param schema Zod schema to validate the arguments
 * @param resolver resolver function to run the method
 * @param config config object to set the rate limit and hooks
 */
export const createPublication = <
  Name extends string,
  Schema extends z.ZodUndefined | z.ZodTypeAny,
  Result,
  // @ts-ignore
  DBResult = Mongo.Cursor<Result>,
  UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined
    ? []
    : [z.input<Schema>]
>(
  name: Name,
  schema: Schema,
  resolver?: (this: MeteorSubscription, args: UnwrappedArgs) => DBResult,
  config?: Config<UnwrappedArgs, DBResult>
) => {
  const hooks = {
    onBeforeResolve: config?.hooks?.onBeforeResolve || [],
    onAfterResolve: config?.hooks?.onAfterResolve || [],
    onErrorResolve: config?.hooks?.onErrorResolve || [],
  };
  const helperName = `${name}__helper`;
  if (Meteor.isServer) {
    Meteor.methods({
      [helperName]: function (...args: unknown[]) {
        if (cachedCollectionsNames[helperName]) {
          return cachedCollectionsNames[helperName];
        }
        const parsed: z.output<Schema> = schema.parse(args);
        // @ts-ignore
        return resolver(parsed)._cursorDescription.collectionName;
      },
    });
    // @ts-ignore
    Meteor.publish(name, function (args: unknown[]) {
      if (schema == null && args.length > 0) {
        throw new Error("Unexpected arguments");
      }
      const parsed: z.output<Schema> = schema.parse(args);

      runHook(hooks.onBeforeResolve, args, parsed);
      if (resolver === undefined) {
        throw new Error(
          `Method ${name} is not implemented please provide the resolver function or use setResolver`
        );
      }

      try {
        const result: DBResult =
          // @ts-ignore
          resolver.call(this, parsed as UnwrappedArgs);
        try {
          cachedCollectionsNames[helperName] =
            // @ts-ignore
            result._cursorDescription.collectionName;
        } catch (e) {}
        runHook(hooks.onAfterResolve, args, parsed, result);
        return result;
      } catch (e) {
        if (!hooks.onErrorResolve.length) {
          throw e;
        }
        runHook(hooks.onErrorResolve, e, args, parsed);
      }
    });
  }

  if (config?.rateLimit) {
    RateLimiterConfig("subscription", name, config.rateLimit);
  }

  function subscribe(
    ...args: Schema extends z.ZodUndefined | z.ZodTypeAny
      ? [SubscriptionCallbacks?]
      : [z.input<Schema>, SubscriptionCallbacks?]
  ): Meteor.SubscriptionHandle {
    return Meteor.subscribe(name, args);
  }

  /**
   * Runs before the resolver function with the given arguments
   * @function
   */
  subscribe.addBeforeResolveHook = (
    fn: (raw: unknown, parsed: z.input<Schema>) => void
  ) => {
    hooks.onBeforeResolve.push(fn);
  };

  /**
   * Runs after the resolver function with the given arguments and result
   * @function
   */
  subscribe.addAfterResolveHook = (
    fn: (raw: unknown, parsed: z.input<Schema>, result: DBResult) => void
  ) => {
    hooks.onAfterResolve.push(fn);
  };

  /**
   * Runs when the resolver function throws an error with the given arguments and error
   * @function
   */
  subscribe.addErrorResolveHook = (
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
  subscribe.setResolver = (
    newResolver: (this: MeteorSubscription, args: z.input<Schema>) => DBResult
  ) => {
    resolver = newResolver;
  };

  subscribe.config = { ...config, name, schema };
  /**
   * Sets the type expectations for the return of resolver function.
   * Also known as Result
   * @function
   */
  // @ts-ignore
  subscribe.expect = <T extends Result, SchemaResult extends Result = Result>(
    // @ts-ignore
    newSchema?: SchemaResult
  ): ReturnSubscription<Name, Schema, Result> => {
    return subscribe as unknown as ReturnSubscription<Name, Schema, Result>;
  };

  subscribe.usePublication = (args: z.input<Schema>) => {
    if (Meteor.isServer)
      throw new Error("usePublication can only be used on the client");
    const { data: collName } = useSuspenseQuery({
      queryKey: [name, args],
      // @ts-ignore
      queryFn: (): string => Meteor.callAsync(helperName, args),
    });
    useSubscribe(name);
    // @ts-ignore
    const coll = Meteor.connection._stores[collName]._getCollection();
    return useFind(() => coll.find(args), [args]) as unknown as Result;
  };

  return subscribe as unknown as ReturnSubscription<Name, Schema, Result>;
};
