import type { Collection } from "../meteor/mongo.js";
import type { SubscribeCallbacks, SubscriptionHandle } from "../meteor/types.js";
import {
  META_COLLECTION,
  publicationCollectionName,
  publicationInstance,
} from "../shared/names.js";
import type { Helper } from "./proxy.js";
import type { Transport } from "./transport.js";

/** Inputs are EJSON, which has no functions, so an object with callbacks is never an input. */
function isCallbacks(value: unknown): value is SubscribeCallbacks {
  if (typeof value !== "object" || value === null) return false;
  const { onReady, onStop } = value as SubscribeCallbacks;
  return typeof onReady === "function" || typeof onStop === "function";
}

/** Subscribes to one publication instance. Used by `subscribe` and by `usePublication`. */
export function subscribeInstance(
  transport: Transport,
  path: string,
  input: unknown,
  callbacks?: SubscribeCallbacks,
): SubscriptionHandle {
  if (transport.canSubscribe) {
    // Create the collections before data can arrive: on the server, Meteor registers
    // stores asynchronously and would apply the first documents late.
    transport.collection(META_COLLECTION);
    transport.collection(publicationCollectionName(publicationInstance(path, input)));
  }
  return transport.subscribe(path, input, callbacks);
}

/** Collections of a shared publication instance, by key. Created on first access. */
export function recordCollections(
  transport: Transport,
  instance: string,
): Record<string, Collection<unknown>> {
  const cache: Record<string, Collection<unknown>> = {};
  return new Proxy(cache, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      target[key] ??= transport.collection(publicationCollectionName(instance, key));
      return target[key];
    },
  });
}

/** Helpers available on every client (no React needed). */
export const coreHelpers: Readonly<Record<string, Helper>> = {
  subscribe: (transport, path, args) =>
    args.length === 1 && isCallbacks(args[0])
      ? subscribeInstance(transport, path, undefined, args[0])
      : subscribeInstance(transport, path, args[0], args[1] as SubscribeCallbacks | undefined),
  collection: (transport, path, args) =>
    transport.collection(publicationCollectionName(publicationInstance(path, args[0]))),
  collections: (transport, path, args) =>
    recordCollections(transport, publicationInstance(path, args[0])),
};
