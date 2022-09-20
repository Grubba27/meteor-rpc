import { Config } from "./types";
import { z } from "zod";
import { RateLimiterConfig } from "./utils/RateLimiterConfig";
import { Subscription as MeteorSubscription } from 'meteor/meteor'

export const createPublication =
  <Name extends string, Schema extends z.ZodTuple | null, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []>
  (name: Name, schema: Schema, run: (this: MeteorSubscription, ...args: UnwrappedArgs) => Result, config?: Config<UnwrappedArgs, Result>) => {

    if (Meteor.isServer) {
      Meteor.publish(name, function (...args: unknown[]) {
        if (schema != null) {
          schema.parse(args)
        } else if (args.length > 0) {
          throw new Error('Unexpected arguments')
        }
        return run.call(this, ...args as UnwrappedArgs)
      })
    }

    if (config?.rateLimit) {
      RateLimiterConfig("subscription", name, config.rateLimit);
    }

    function subscribe(...args: UnwrappedArgs) {
      return Meteor.subscribe(name, ...args)
    }


    subscribe.config = { ...config, name, schema }

    return subscribe
  }
