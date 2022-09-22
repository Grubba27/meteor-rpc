import { z } from "zod";
import { Config, ReturnMethod } from "../types"
import { isThenable } from './utils/isThenable'
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Meteor } from "meteor/meteor";
import { runHook } from "./utils/runHook";

export const createMethod =
  <Name extends string, Schema extends z.ZodUndefined | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined  ? [] : [z.input<Schema>]>
  (name: Name, schema: Schema, resolver?: (args: z.input<Schema>) => Result, config?: Config<z.input<Schema>, Result>) => {
    const hooks = {
      onBeforeResolve: config?.hooks?.onBeforeResolve || [],
      onAfterResolve: config?.hooks?.onAfterResolve || [],
      onErrorResolve: config?.hooks?.onErrorResolve || [],
    }
    if (Meteor.isServer) {
      Meteor.methods({
        [name](data: unknown) {

          const parsed: z.output<Schema> = schema.parse(data);
          runHook(hooks.onBeforeResolve, data, parsed);

          if (resolver === undefined) {
            throw new Error(`Method ${ name } is not implemented please provide the resolver function or use setResolver`)
          }

          try {
            const result: Result = resolver(parsed)
            runHook(hooks.onAfterResolve, data, parsed, result);
            if (isThenable(result)) {
              return (Promise as any).await(result);
            } else {
              return result;
            }
          } catch (e: Meteor.Error | Error | unknown) {
            runHook(hooks.onErrorResolve, e, data, parsed);
          }
        }
      });
      if (config?.rateLimit) {
        RateLimiterConfig("method", name, config.rateLimit);
      }
    }

    function call(args?: z.input<Schema>): Promise<Result> {
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
      (fn: (raw: unknown, parsed: z.input<Schema>) => void) => {
        hooks.onBeforeResolve.push(fn);
      }

    call.addAfterResolveHook =
      (fn: (raw: unknown, parsed: z.input<Schema>, result: Result) => void) => {
        hooks.onAfterResolve.push(fn);
      }

    call.addErrorResolveHook =
      (fn: (err: Meteor.Error | Error | unknown, raw: unknown, parsed: z.input<Schema>) => void) => {
        hooks.onErrorResolve.push(fn);
      }

    call.setResolver =
      (newResolver: (args: z.input<Schema>) => Result) => {
        resolver = newResolver
      };

    call.config = { ...config, name, schema }

    call.expect = <T extends Result>(): ReturnMethod<Name, Schema, Result> => {
      return call as ReturnMethod<Name, Schema, Result>
    }

    return call as ReturnMethod<Name, Schema, Result>;
  }
