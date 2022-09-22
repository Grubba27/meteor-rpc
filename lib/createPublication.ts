import { Config, ReturnSubscription } from "../types";
import { z } from "zod";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor, Subscription as MeteorSubscription } from 'meteor/meteor'

export const createPublication =
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []>
  (name: Name, schema: Schema, resolver?: (this: MeteorSubscription, ...args: UnwrappedArgs) => Result, config?: Config<UnwrappedArgs, Result>) => {
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
        const parsed: UnwrappedArgs = schema.parse(args)
        hooks
          .onBeforeResolve
          .map((fn) => fn(args, parsed))

        if (resolver === undefined) {
          throw new Error(`Method ${name} is not implemented please provide the resolver function or use setResolver`)
        }

        try {
          const result = resolver.call(this, ...args as UnwrappedArgs)
          hooks
            .onAfterResolve
            .map(fn => fn(args, parsed, result));
          return result
        } catch (e) {
          hooks
            .onErrorResolve
            .map(fn => fn(e, args, parsed))
        }
      })
    }

    if (config?.rateLimit) {
      RateLimiterConfig("subscription", name, config.rateLimit);
    }

    function subscribe(...args: UnwrappedArgs) {
      return Meteor.subscribe(name, ...args)
    }

    subscribe.addBeforeResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs) => void) => {
        hooks.onBeforeResolve.push(fn);
      }

    subscribe.addAfterResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs, result: Result) => void) => {
        hooks.onAfterResolve.push(fn);

      }

    subscribe.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: UnwrappedArgs) => void) => {
        hooks.onErrorResolve.push(fn);
      }

    subscribe.setResolver =
      (newResolver: (this: MeteorSubscription, ...args: UnwrappedArgs) => Result) => {
      resolver = newResolver
    }

    subscribe.config = { ...config, name, schema }

    return subscribe as ReturnSubscription<Name, Schema, Result>
  }
