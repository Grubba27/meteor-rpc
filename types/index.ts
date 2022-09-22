import { Meteor } from "meteor/meteor";
import { z } from "zod"

type BeforeHook<Schema extends z.ZodUndefined | z.ZodTypeAny> =
  (fn: (raw: unknown, parsed: z.infer<Schema>) => void) => void;

type AfterHook<Schema extends z.ZodUndefined | z.ZodTypeAny, Result> =
  (fn: (raw: unknown, parsed: z.infer<Schema>, result: Result) => void) => void;

type ErrorHook<Schema extends z.ZodUndefined | z.ZodTypeAny> =
  (fn: (error: unknown, raw: unknown, parsed: z.infer<Schema>) => void) => void;

type Resolver<Schema extends z.ZodUndefined | z.ZodTypeAny, Result> =
  (newResolver: (args: z.input<Schema>) => Result) => void;

type ReturnMethod<Name extends string, Schema extends z.ZodUndefined | z.ZodTypeAny, Result, UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined ? [] : [z.input<Schema>]> = {
  config: {
    name: Name;
    schema: Schema,
    rateLimit?: {
      interval: number,
      limit: number
    },
    methodHooks?: {
      onBeforeResolve?: Array<(raw: unknown, parsed: z.input<Schema>) => void>;
      onAfterResolve?: Array<(raw: unknown, parsed: z.input<Schema>, result: Result) => void>;
      onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: unknown, parsed: z.input<Schema>) => void>;
    }
  };
  addBeforeResolveHook: BeforeHook<Schema>;
  addAfterResolveHook: AfterHook<Schema, Result>;
  addErrorResolveHook: ErrorHook<Schema>;

  setResolver: Resolver<Schema, Result>;

  expect: <T>() => ReturnMethod<Name, Schema, T>

  <T>(args?: z.input<Schema>): Promise<Result> & Promise<T>;
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
      onBeforeResolve?: Array<(args?: unknown, parsed?: z.input<Schema>) => void>;
      onAfterResolve?: Array<(args?: z.input<Schema>, result?: Result) => void>;
      onErrorResolve?: Array<(err?: Meteor.Error | Error | unknown, raw?: unknown, parsed?: z.input<Schema>) => void>;
    }
  };
  addBeforeResolveHook: BeforeHook<Schema>;
  addAfterResolveHook: AfterHook<Schema, Result>;
  addErrorResolveHook: ErrorHook<Schema>;

  setResolver: Resolver<Schema, Result>;

  expect: <T>() => ReturnSubscription<Name, Schema, T>

  (args: z.input<Schema>): Meteor.SubscriptionHandle
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
