// Adapted from react-meteor-data 4.0.1, suspense/useSubscribe.ts
// MIT License, Copyright (c) 2011 - present Meteor Software Ltd.
// https://github.com/meteor/react-packages/tree/master/packages/react-meteor-data
//
// Changes from upstream:
// - subscribes through a meteor-rpc Transport, so custom DDP connections work;
// - one cache per connection, keyed by EJSON of [name, input] (input omitted when undefined);
// - sends a single input argument, like every meteor-rpc subscription, and creates the
//   publication's client collections before subscribing (subscribeInstance);
// - a failed subscription is evicted shortly after it is thrown, so an error
//   boundary reset can retry instead of re-throwing the cached error forever.

import { useEffect, useRef } from "react";
import { subscribeInstance } from "../../client/helpers.js";
import type { Transport } from "../../client/transport.js";
import { EJSON } from "../../meteor/ejson.js";
import type { SubscriptionHandle } from "../../meteor/types.js";

interface Entry {
  handle?: SubscriptionHandle;
  promise: Promise<void>;
  ready?: true;
  error?: unknown;
  counter: number;
}

const caches = new WeakMap<object, Map<string, Entry>>();

function cacheFor(transport: Transport): Map<string, Entry> {
  let cache = caches.get(transport.connection);
  if (!cache) {
    cache = new Map();
    caches.set(transport.connection, cache);
  }
  return cache;
}

/** Suspends until the subscription is ready. Returns immediately during server-side rendering. */
export function useSubscribeSuspense(transport: Transport, name: string, input: unknown): void {
  const cache = cacheFor(transport);
  const key = EJSON.stringify(input === undefined ? [name] : [name, input]);
  const cleanupTimeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    // In StrictMode effects run twice. A pending cleanup for the same key means this is
    // the second run: cancel the cleanup instead of counting the component twice.
    const pending = cleanupTimeouts.current.get(key);
    if (pending !== undefined) {
      clearTimeout(pending);
      cleanupTimeouts.current.delete(key);
    } else {
      const entry = cache.get(key);
      if (entry) entry.counter++;
    }

    return () => {
      cleanupTimeouts.current.set(
        key,
        setTimeout(() => {
          cleanupTimeouts.current.delete(key);
          const entry = cache.get(key);
          if (!entry) return;
          entry.counter--;
          if (entry.counter <= 0) {
            entry.handle?.stop();
            cache.delete(key);
          }
        }, 0),
      );
    };
  }, [key, cache]);

  if (!transport.canSubscribe) return;

  const cached = cache.get(key);
  if (cached) {
    if ("error" in cached) {
      setTimeout(() => {
        if (cache.get(key) === cached) cache.delete(key);
      }, 0);
      throw cached.error;
    }
    if (cached.ready) return;
    throw cached.promise;
  }

  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const entry: Entry = {
    counter: 0,
    promise: new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    }),
  };
  // Suspense re-renders after the promise settles; nothing else awaits it.
  entry.promise.catch(() => {});
  entry.handle = subscribeInstance(transport, name, input, {
    onReady() {
      entry.ready = true;
      resolve();
    },
    onStop(error?: unknown) {
      if (entry.ready && error === undefined) return;
      entry.error = error ?? new Error(`meteor-rpc: subscription "${name}" stopped`);
      reject(entry.error);
    },
  });
  cache.set(key, entry);
  throw entry.promise;
}
