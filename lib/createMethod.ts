import { z } from "zod";
import { Config, ReturnMethod } from "../types"
import { isThenable } from './utils/isThenable'
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor } from "meteor/meteor";

export const createMethod =
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTypeAny ? z.infer<Schema> : []>
  (name: Name, schema: Schema, resolver?: (...args: UnwrappedArgs) => Result, config?: Config<UnwrappedArgs, Result>) => {
    const hooks = {
      onBeforeResolve: config?.hooks?.onBeforeResolve || [],
      onAfterResolve: config?.hooks?.onAfterResolve || [],
      onErrorResolve: config?.hooks?.onErrorResolve || [],
    }
    if (Meteor.isServer) {
      Meteor.methods({
        [name](data: unknown[]) {
          const parsed: UnwrappedArgs = schema.parse(data);
          hooks
            .onBeforeResolve
            .map((fn) => fn(data, parsed))

          if (resolver === undefined) {
            throw new Error(`Method ${ name } is not implemented please provide the resolver function or use setResolver`)
          }

          try {
            const result: Result = resolver(...parsed)
            hooks
              .onAfterResolve
              .map(fn => fn(data, parsed, result));
            if (isThenable(result)) {
              return (Promise as any).await(result);
            } else {
              return result;
            }
          } catch (e: Meteor.Error | Error | unknown) {
            hooks
              .onErrorResolve
              .map(fn => fn(e, data, parsed));
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
        hooks.onBeforeResolve.push(fn);
      }

    call.addAfterResolveHook =
      (fn: (raw: unknown, parsed: UnwrappedArgs, result: Result) => void) => {
        hooks.onAfterResolve.push(fn);
      }

    call.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: UnwrappedArgs) => void) => {
        hooks.onErrorResolve.push(fn);
      }

    call.setResolver =
      (newResolver: (...args: UnwrappedArgs) => Result) => {
        resolver = newResolver
      };

    call.expect = <T>(): ReturnMethod<Name, Schema, T> => {
      const futureResolver: (...args: UnwrappedArgs) => T = resolver as unknown as (...args: UnwrappedArgs) => T
      const futureConfig = config as unknown as Config<UnwrappedArgs, T>
      // TODO: think of a better way to do this
      // @ts-ignore
      delete Meteor.server.method_handlers[name]
      return createMethod<Name, Schema, T>(name, schema, futureResolver, futureConfig) as ReturnMethod<Name, Schema, T>
    }


    call.config = { ...config, name, schema }

    return call as ReturnMethod<Name, Schema, Result>;
  }
