import { Meteor } from "meteor/meteor";
import { z } from "zod"

type BeforeHook<Schema extends z.ZodTuple | z.ZodTypeAny> =
  (fn: (raw: unknown, parsed: z.infer<Schema>) => void) => void;

type AfterHook<Schema extends z.ZodTuple | z.ZodTypeAny, Result> =
  (fn: (raw: unknown, parsed: z.infer<Schema>, result: Result) => void) => void;

type ErrorHook<Schema extends z.ZodTuple | z.ZodTypeAny> =
  (fn: (error: unknown, raw: unknown, parsed: z.infer<Schema>) => void) => void;

type ReturnMethod
  <Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTypeAny ? z.infer<Schema> : []> = {
  config: {
    name: Name;
    schema: Schema,
    rateLimit?: {
      interval: number,
      limit: number
    },
    methodHooks?: {
      onBeforeResolve?: Array<(raw: unknown, parsed: UnwrappedArgs) => void>;
      onAfterResolve?: Array<(raw: unknown, parsed: UnwrappedArgs, result: Result) => void>;
      onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: unknown, parsed: UnwrappedArgs) => void>;
    }
  };
  addBeforeResolveHook: BeforeHook<Schema>;
  addAfterResolveHook: AfterHook<Schema, Result>;
  addErrorResolveHook: ErrorHook<Schema>;

  (...args: UnwrappedArgs): Promise<Result>
}

type ReturnSubscription<Name extends string, Schema extends z.ZodTuple | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodTuple ? z.infer<Schema> : []> = {
  config: {
    name: Name;
    schema: Schema,
    rateLimit?: {
      interval: number,
      limit: number
    },
    methodHooks?: {
      onBeforeResolve?: Array<(args?: unknown, parsed?: UnwrappedArgs) => void>;
      onAfterResolve?: Array<(args?: UnwrappedArgs, result?: Result) => void>;
      onErrorResolve?: Array<(err?: Meteor.Error | Error | unknown, raw?: unknown, parsed?: UnwrappedArgs) => void>;
    }
  };
  addBeforeResolveHook: BeforeHook<Schema>;
  addAfterResolveHook: AfterHook<Schema, Result>;
  addErrorResolveHook: ErrorHook<Schema>;

  (...args: UnwrappedArgs): Meteor.SubscriptionHandle
}
type Maybe<T> = T | null | undefined | unknown;
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  hooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S,) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void>;
  }
}

interface SubscriptionCallbacks {
  onStop?: (err?: any) => void,
  onReady?: () => void
}

export {
  ReturnMethod,
  ReturnSubscription,
  Config,
  SubscriptionCallbacks,
}
