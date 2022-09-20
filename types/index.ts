import { Meteor } from "meteor/meteor";
import { z } from "zod"
import { createPublication } from "../lib/createPublication";
import { createMethod } from "../lib/createMethod";

type ReturnMethod<Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []> = {
  config: {
    name: Name;
    schema: Schema,
    rateLimit?: {
      interval: number,
      limit: number
    },
    methodHooks?: {
      beforeResolve?: (args: UnwrappedArgs, err: null | Meteor.Error, result: Result) => void,
      afterResolve?: (args: UnwrappedArgs, result: Result) => void
      onErrorResolve?: (err: null | Meteor.Error, result: Result) => void,
    }
  };
  (...args: UnwrappedArgs): Promise<Result>
}

type ReturnSubscription<Name extends string, Schema extends z.ZodTuple | null, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []> = {
  config: {
    name: Name;
    schema: Schema,
    rateLimit?: {
      interval: number,
      limit: number
    }
  };
  (...args: UnwrappedArgs): Meteor.SubscriptionHandle
}
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  methodHooks?: {
    beforeResolve?: (args: S, err: null | Meteor.Error, result: T) => void,
    afterResolve?: (args: S, result: T) => void
    onErrorResolve?: (err: null | Meteor.Error, result: T) => void,
  }
}

interface SubscriptionCallbacks {
  onStop?: (err?: any) => void,
  onReady?: () => void
}
type createMethod = typeof createMethod;
type createPublication = typeof createPublication;

export {
  createMethod,
  createPublication,
  ReturnMethod,
  ReturnSubscription,
  Config,
  SubscriptionCallbacks,
}
