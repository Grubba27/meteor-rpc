import { useMemo, useSyncExternalStore } from "react";
import { recordCollections } from "../client/helpers.js";
import type { Transport } from "../client/transport.js";
import { Tracker } from "../meteor/tracker.js";
import {
  META_COLLECTION,
  type PublicationMeta,
  publicationCollectionName,
  publicationInstance,
} from "../shared/names.js";
import { useFind } from "./vendor/use-find.js";
import { useSubscribeSuspense } from "./vendor/use-subscribe.js";

const EMPTY: readonly never[] = Object.freeze([]);

/** Re-runs `compute` whenever its Tracker dependencies change. */
function useTrackerValue<T>(compute: () => T, deps: readonly unknown[]): T {
  const store = useMemo(() => {
    let value = Tracker.nonreactive(compute);
    return {
      subscribe(onChange: () => void) {
        const computation = Tracker.autorun((current) => {
          value = compute();
          if (!current.firstRun) onChange();
        });
        return () => computation.stop();
      },
      getSnapshot: () => value,
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are provided by the caller
  }, deps);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Missing keys read as an empty list, so `data.rooms` is always an array. */
function withEmptyDefault<T extends object>(record: T): T {
  return new Proxy(record, {
    get(target, key, receiver) {
      if (typeof key === "string" && !(key in target)) return EMPTY;
      return Reflect.get(target, key, receiver);
    },
  });
}

export function usePublication(transport: Transport, path: string, input: unknown): unknown {
  useSubscribeSuspense(transport, path, input);
  const instance = publicationInstance(path, input);

  // Read once the subscription is ready: the server sends the meta document before `ready`.
  const meta = transport.canSubscribe
    ? Tracker.nonreactive(() =>
        transport.collection<PublicationMeta>(META_COLLECTION).findOne(instance),
      )
    : undefined;
  const shape = meta?.shape ?? "cursor";
  const keysJson = JSON.stringify(shape === "record" ? (meta?.keys ?? []) : []);

  const collection = useMemo(
    () =>
      transport.canSubscribe && shape === "cursor"
        ? transport.collection(publicationCollectionName(instance))
        : null,
    [transport, instance, shape],
  );
  const docs = useFind(() => collection?.find() ?? null, [collection]);

  const collections = useMemo(
    () =>
      transport.canSubscribe && shape === "record" ? recordCollections(transport, instance) : null,
    [transport, instance, shape],
  );
  const record = useTrackerValue(() => {
    if (!collections) return null;
    const keys = JSON.parse(keysJson) as string[];
    return withEmptyDefault(
      Object.fromEntries(keys.map((key) => [key, collections[key]!.find().fetch()])),
    );
  }, [collections, keysJson]);

  if (shape === "record") {
    return { data: record ?? withEmptyDefault({}), collections };
  }
  return { data: docs ?? EMPTY, collection };
}
