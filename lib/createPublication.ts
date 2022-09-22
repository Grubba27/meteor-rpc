import { Config, ReturnSubscription } from "../types";
import { z } from "zod";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor, Subscription as MeteorSubscription } from 'meteor/meteor'
import { runHook } from "./utils/runHook";

export const createPublication =
  <Name extends string, Schema extends z.ZodUndefined | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined ? [] : [z.input<Schema>]>
  (name: Name, schema: Schema, resolver?: (this: MeteorSubscription, args: UnwrappedArgs) => Result, config?: Config<UnwrappedArgs, Result>) => {
    const hooks = {
      onBeforeResolve: config?.hooks?.onBeforeResolve || [],
      onAfterResolve: config?.hooks?.onAfterResolve || [],
      onErrorResolve: config?.hooks?.onErrorResolve || [],
    }
    if (Meteor.isServer) {
      Meteor.publish(name, function (args: unknown[]) {
        if (schema == null && args.length > 0) {
          throw new Error('Unexpected arguments')
        }
        const parsed: z.output<Schema> = schema.parse(args)


        runHook(hooks.onBeforeResolve, args, parsed);
        if (resolver === undefined) {
          throw new Error(`Method ${name} is not implemented please provide the resolver function or use setResolver`)
        }

        try {
          const result = resolver.call(this, args as UnwrappedArgs)
          runHook(hooks.onAfterResolve, args, parsed, result);
          return result
        } catch (e) {
          runHook(hooks.onErrorResolve, e, args, parsed);
        }
      })
    }

    if (config?.rateLimit) {
      RateLimiterConfig("subscription", name, config.rateLimit);
    }

    function subscribe(args: z.input<Schema>) {
      return Meteor.subscribe(name,  args)
    }

    subscribe.addBeforeResolveHook =
      (fn: (raw: unknown, parsed: z.input<Schema>) => void) => {
        hooks.onBeforeResolve.push(fn);
      }

    subscribe.addAfterResolveHook =
      (fn: (raw: unknown, parsed: z.input<Schema>, result: Result) => void) => {
        hooks.onAfterResolve.push(fn);

      }

    subscribe.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: z.input<Schema>) => void) => {
        hooks.onErrorResolve.push(fn);
      }

    subscribe.setResolver =
      (newResolver: (this: MeteorSubscription, args: z.input<Schema>) => Result) => {
      resolver = newResolver
    }

    subscribe.config = { ...config, name, schema }

    subscribe.expect = <T extends Result>(): ReturnSubscription<Name, Schema, Result> => {
      return subscribe as ReturnSubscription<Name, Schema, Result>
    }
    return subscribe as ReturnSubscription<Name, Schema, Result>
  }
