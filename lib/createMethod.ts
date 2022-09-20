import { z } from "zod";
import { Config, ReturnMethod } from "../types"
import { isThenable } from './utils/isThenable'
import { RateLimiterConfig } from "./utils/RateLimiterConfig";


export const createMethod =
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTypeAny ? z.infer<Schema> : []>
  (name: Name, schema: Schema, run: (...args: UnwrappedArgs) => Result, config?: Config<UnwrappedArgs, Result>) => {

    Meteor.methods({
      [name](data: unknown[]) {
        const parsed: UnwrappedArgs = schema.parse(data);
        const result: Result = run(...parsed)

        if (isThenable(result)) {
          return (Promise as any).await(result);
        } else {
          return result;
        }
      }
    });

    if (config?.rateLimit) {
      RateLimiterConfig("method", name, config.rateLimit);
    }

    function call(...args: UnwrappedArgs): Promise<Result> {
      return new Promise<Result>((resolve, reject) => {
        Meteor.call(name, args, (err: null | Meteor.Error, result: Result) => {
          if (config?.methodHooks?.beforeResolve) {
            config.methodHooks.beforeResolve(args, err, result)
          }
          if (err) {
            if (config?.methodHooks?.onErrorResolve) {
              config.methodHooks.onErrorResolve(err, result)
            }
            reject(err);
          } else {
            resolve(result);
            if (config?.methodHooks?.afterResolve) {
              config.methodHooks.afterResolve(args, result)
            }
          }
        });
      });
    }

    call.config = { ...config, name, schema }

    return call as ReturnMethod<Name, Schema, Result>;
  }
