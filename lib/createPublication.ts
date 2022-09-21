import { Config, ReturnSubscription } from "../types";
import { z } from "zod";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor, Subscription as MeteorSubscription } from 'meteor/meteor'

export const createPublication =
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []>
  (name: Name, schema: Schema, run: (this: MeteorSubscription, ...args: UnwrappedArgs) => Result, config: Config<UnwrappedArgs, Result> = {
    methodHooks: {
      onErrorResolve: [],
      onAfterResolve: [],
      onBeforeResolve: []
    }
  }) => {
    if (Meteor.isServer) {
      Meteor.publish(name, function (args: unknown[]) {
        if (schema == null && args.length > 0) {
          throw new Error('Unexpected arguments')
        }
        const parsed: UnwrappedArgs = schema.parse(args)
        if (config?.methodHooks?.onBeforeResolve) {
          config
            .methodHooks
            .onBeforeResolve
            .map((fn) => fn(args, parsed))
        }
        try {
          const result = run.call(this, ...args as UnwrappedArgs)
          if (config?.methodHooks?.onAfterResolve) {
            config
              .methodHooks
              .onAfterResolve
              .map(fn => fn(args, parsed, result));
          }
          return result
        } catch (e) {
          if (config?.methodHooks?.onErrorResolve) {
            config
              .methodHooks
              .onErrorResolve
              .map(fn => fn(e, args, parsed))
          }
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
        if (config?.methodHooks?.onBeforeResolve) {
          config.methodHooks.onBeforeResolve.push(fn);
        }
      }

    subscribe.addAfterResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs, result: Result) => void) => {
        if (config?.methodHooks?.onAfterResolve) {
          config.methodHooks.onAfterResolve.push(fn);
        }
      }

    subscribe.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: UnwrappedArgs) => void)  => {
        if (config?.methodHooks?.onErrorResolve) {
          config.methodHooks.onErrorResolve.push(fn);
        }
      }

    subscribe.config = { ...config, name, schema }

    return subscribe as ReturnSubscription<Name, Schema, Result>
  }
