import { z } from "zod";
import { Config, ReturnMethod } from "../types"
import { isThenable } from './utils/isThenable'
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor } from "meteor/meteor";


export const createMethod =
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTypeAny ? z.infer<Schema> : []>
  (name: Name, schema: Schema, run: (...args: UnwrappedArgs) => Result, config: Config<UnwrappedArgs, Result> = {
    methodHooks: {
      onErrorResolve: [],
      onAfterResolve: [],
      onBeforeResolve: []
    }
  }) => {
    if (Meteor.isServer) {
      Meteor.methods({
        [name](data: unknown[]) {
          const parsed: UnwrappedArgs = schema.parse(data);
          if (config?.methodHooks?.onBeforeResolve) {
            config
              .methodHooks
              .onBeforeResolve
              .map((fn) => fn(data, parsed))
          }
          try {
            const result: Result = run(...parsed)
            if (config?.methodHooks?.onAfterResolve) {
              config
                .methodHooks
                .onAfterResolve
                .map(fn => fn(data, parsed, result));
            }
            if (isThenable(result)) {
              return (Promise as any).await(result);
            } else {
              return result;
            }
          } catch (e: Meteor.Error | Error | unknown) {
            if (config?.methodHooks?.onErrorResolve) {
              config
                .methodHooks
                .onErrorResolve
                .map(fn => fn(e, data, parsed));
            }
          }
        }
      });
      if (config?.rateLimit) {
        RateLimiterConfig("method", name, config.rateLimit);
      }
    }

    function call(...args: UnwrappedArgs): Promise<Result> {
      return new Promise<Result>((resolve, reject) => {
        Meteor.call(name, args, (err: null | Meteor.Error, result: Result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    }

    call.addBeforeResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs) => void) => {
        if (config?.methodHooks?.onBeforeResolve) {
          config.methodHooks.onBeforeResolve.push(fn);
        }
      }

    call.addAfterResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs, result: Result) => void) => {
        if (config?.methodHooks?.onAfterResolve) {
          config.methodHooks.onAfterResolve.push(fn);
        }
      }

    call.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: UnwrappedArgs) => void)  => {
        if (config?.methodHooks?.onErrorResolve) {
          config.methodHooks.onErrorResolve.push(fn);
        }
      }

    call.config = { ...config, name, schema }

    return call as ReturnMethod<Name, Schema, Result>;
  }
