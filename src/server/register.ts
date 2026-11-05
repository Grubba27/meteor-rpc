import { Meteor } from "../meteor/meteor.js";
import type { Cursor, LiveQueryHandle } from "../meteor/mongo.js";
import { getRateLimiter } from "../meteor/rate-limiter.js";
import type { MethodInvocation, Subscription } from "../meteor/types.js";
import {
  META_COLLECTION,
  publicationCollectionName,
  publicationInstance,
} from "../shared/names.js";
import { type AnySchema, createValidationError, validate } from "../shared/schema.js";
import type {
  Hooks,
  MethodContext,
  Middleware,
  PublicationContext,
  RateLimit,
  RpcContext,
} from "../shared/types.js";
import type { MethodEntry, ModuleState, PublicationEntry } from "./module.js";

type AnyHooks = Required<{
  [K in keyof Hooks<any, any, any>]: ReadonlyArray<(context: any) => unknown>;
}>;

interface Registration {
  readonly name: string;
  readonly entry: MethodEntry | PublicationEntry;
  readonly middlewares: readonly Middleware[];
}

/** Flattens the module tree into definitions with full dotted names and their middleware chain. */
function collect(
  state: ModuleState,
  path: readonly string[],
  inherited: readonly Middleware[],
  out: Registration[],
): Registration[] {
  const middlewares = [...inherited, ...state.middlewares];
  for (const entry of state.entries) {
    const entryPath = [...path, entry.name];
    if (entry.kind === "submodule") collect(entry.state, entryPath, middlewares, out);
    else out.push({ name: entryPath.join("."), entry, middlewares });
  }
  return out;
}

/**
 * Registers every method and publication of `state`. Everything is validated first, so a
 * configuration error never leaves the module half-registered.
 */
export function registerModule(state: ModuleState): void {
  const registrations = collect(state, [], [], []);
  for (const { name, entry } of registrations) {
    if (entry.config?.rateLimit) checkRateLimit(name, entry.config.rateLimit);
  }
  for (const { name, entry, middlewares } of registrations) {
    if (entry.kind === "method") registerMethod(name, entry, middlewares);
    else registerPublication(name, entry, middlewares);
  }
}

function copyHooks(hooks: Hooks<any, any, any> | undefined): AnyHooks {
  // Copied so hooks added to one config object never leak into another definition.
  return {
    onBeforeResolve: [...(hooks?.onBeforeResolve ?? [])],
    onAfterResolve: [...(hooks?.onAfterResolve ?? [])],
    onErrorResolve: [...(hooks?.onErrorResolve ?? [])],
  };
}

/**
 * The single pipeline every call goes through:
 * validate -> middlewares -> onBeforeResolve -> resolver -> onAfterResolve.
 * On any error the onErrorResolve hooks run and the error is re-thrown.
 */
async function runPipeline(
  context: RpcContext,
  args: unknown[],
  schema: AnySchema,
  middlewares: readonly Middleware[],
  hooks: AnyHooks,
  resolve: (parsed: unknown) => unknown,
): Promise<unknown> {
  const raw = args[0];
  let parsed: unknown;
  try {
    if (args.length > 1) {
      throw createValidationError([
        { message: `Expected at most 1 argument, received ${args.length}`, path: [] },
      ]);
    }
    parsed = await validate(schema, raw);
    const hookContext = { ...context, raw, parsed };
    for (const middleware of middlewares) await middleware(hookContext);
    for (const hook of hooks.onBeforeResolve) await hook(hookContext);
    const result = await resolve(parsed);
    for (const hook of hooks.onAfterResolve) await hook({ ...hookContext, result });
    return result;
  } catch (error) {
    const errorContext = { ...context, raw, parsed, error };
    for (const hook of hooks.onErrorResolve) {
      try {
        await hook(errorContext);
      } catch (hookError) {
        console.error(`meteor-rpc: an onErrorResolve hook of "${context.name}" threw`, hookError);
      }
    }
    throw error;
  }
}

function checkRateLimit(name: string, rateLimit: RateLimit): void {
  const { limit, interval } = rateLimit;
  if (!(Number.isInteger(limit) && limit > 0 && Number.isFinite(interval) && interval > 0)) {
    throw new TypeError(
      `meteor-rpc: rateLimit of "${name}" needs a positive integer \`limit\` and a positive \`interval\` (ms)`,
    );
  }
  getRateLimiter();
}

function addRateLimit(type: "method" | "subscription", name: string, rateLimit: RateLimit): void {
  getRateLimiter().addRule(
    {
      type,
      name,
      // Returning true makes each value part of the bucket key: limits apply per connection.
      connectionId: () => true,
      userId: () => true,
      clientAddress: () => true,
    },
    rateLimit.limit,
    rateLimit.interval,
  );
}

function registerMethod(
  name: string,
  entry: MethodEntry,
  middlewares: readonly Middleware[],
): void {
  const { schema, resolver, config } = entry;
  const hooks = copyHooks(config?.hooks);
  Meteor.methods({
    [name](this: MethodInvocation, ...args: unknown[]) {
      const context: MethodContext = {
        type: "method",
        name,
        userId: this.userId,
        connection: this.connection,
        invocation: this,
      };
      return runPipeline(context, args, schema, middlewares, hooks, (parsed) =>
        resolver.call(this, parsed, context),
      );
    },
  });
  if (config?.rateLimit) addRateLimit("method", name, config.rateLimit);
}

function isCursor(value: unknown): value is Cursor {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { observeChanges?: unknown }).observeChanges === "function"
  );
}

async function observeInto(
  subscription: Subscription,
  collection: string,
  cursor: Cursor,
): Promise<LiveQueryHandle> {
  const callbacks = {
    added: (id: string, fields: Record<string, unknown>) =>
      subscription.added(collection, id, fields),
    changed: (id: string, fields: Record<string, unknown>) =>
      subscription.changed(collection, id, fields),
    removed: (id: string) => subscription.removed(collection, id),
  };
  const options = { nonMutatingCallbacks: true };
  return cursor.observeChangesAsync
    ? cursor.observeChangesAsync(callbacks, options)
    : cursor.observeChanges(callbacks, options);
}

/**
 * Publishes the resolver result into meteor-rpc's own client collections, scoped to this
 * publication instance (path + input): one for a cursor publication, one per key of a shared
 * publication, plus a meta document telling the client which shape and keys to expect.
 */
async function publishResult(
  subscription: Subscription,
  name: string,
  instance: string,
  shape: "cursor" | "record",
  result: unknown,
): Promise<void> {
  let stopped = false;
  const handles: LiveQueryHandle[] = [];
  subscription.onStop(() => {
    stopped = true;
    for (const handle of handles) handle.stop();
  });
  const track = (handle: LiveQueryHandle) => {
    if (stopped) handle.stop();
    else handles.push(handle);
  };

  if (shape === "cursor") {
    if (result != null && !isCursor(result)) {
      throw new TypeError(
        `meteor-rpc: publication "${name}" must return a Mongo cursor or nothing. ` +
          "To publish several cursors use addSharedPublication and return { key: cursor }.",
      );
    }
    subscription.added(META_COLLECTION, instance, { shape: "cursor" });
    if (result != null) {
      track(await observeInto(subscription, publicationCollectionName(instance), result));
    }
    return;
  }

  if (result != null && (typeof result !== "object" || Array.isArray(result) || isCursor(result))) {
    throw new TypeError(
      `meteor-rpc: shared publication "${name}" must return an object of cursors, e.g. { rooms: Rooms.find() }, or nothing.`,
    );
  }
  const entries = result == null ? [] : Object.entries(result as Record<string, unknown>);
  subscription.added(META_COLLECTION, instance, {
    shape: "record",
    keys: entries.map(([key]) => key),
  });
  for (const [key, cursor] of entries) {
    if (cursor == null) continue;
    if (!isCursor(cursor)) {
      throw new TypeError(
        `meteor-rpc: key "${key}" of shared publication "${name}" is not a Mongo cursor.`,
      );
    }
    track(await observeInto(subscription, publicationCollectionName(instance, key), cursor));
  }
}

function registerPublication(
  name: string,
  entry: PublicationEntry,
  middlewares: readonly Middleware[],
): void {
  const { schema, resolver, config, shape } = entry;
  const hooks = copyHooks(config?.hooks);
  Meteor.publish(name, async function (this: Subscription, ...args: unknown[]) {
    const context: PublicationContext = {
      type: "publication",
      name,
      userId: this.userId,
      connection: this.connection,
      subscription: this,
    };
    // Keyed by the raw input, which the client hashes the same way before subscribing.
    const instance = publicationInstance(name, args[0]);
    await runPipeline(context, args, schema, middlewares, hooks, async (parsed) => {
      const result = await resolver.call(this, parsed, context);
      await publishResult(this, name, instance, shape, result);
      return result;
    });
    this.ready();
  });
  if (config?.rateLimit) addRateLimit("subscription", name, config.rateLimit);
}
