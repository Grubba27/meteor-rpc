// Adapted from react-meteor-data 4.0.1, useFind.ts
// MIT License, Copyright (c) 2011 - present Meteor Software Ltd.
// https://github.com/meteor/react-packages/tree/master/packages/react-meteor-data
//
// Changes from upstream:
// - typed against meteor-rpc's Meteor boundary instead of `meteor/*` declarations;
// - `useReducer` called in the form both @types/react 18 and 19 accept;
// - client only: meteor-rpc never reads publication data during server-side rendering.

import { type DependencyList, useEffect, useMemo, useReducer } from "react";
import { Meteor } from "../../meteor/meteor.js";
import { type Cursor, Mongo } from "../../meteor/mongo.js";
import { Tracker } from "../../meteor/tracker.js";

type Action<T> =
  | { type: "refresh"; data: T[] }
  | { type: "addedAt"; document: T; atIndex: number }
  | { type: "changedAt"; document: T; atIndex: number }
  | { type: "removedAt"; atIndex: number }
  | { type: "movedTo"; fromIndex: number; toIndex: number };

function reducer<T>(data: T[], action: Action<T>): T[] {
  switch (action.type) {
    case "refresh":
      return action.data;
    case "addedAt":
      return [...data.slice(0, action.atIndex), action.document, ...data.slice(action.atIndex)];
    case "changedAt":
      return [...data.slice(0, action.atIndex), action.document, ...data.slice(action.atIndex + 1)];
    case "removedAt":
      return [...data.slice(0, action.atIndex), ...data.slice(action.atIndex + 1)];
    case "movedTo": {
      const doc = data[action.fromIndex];
      if (doc === undefined) return data;
      const copy = [...data.slice(0, action.fromIndex), ...data.slice(action.fromIndex + 1)];
      copy.splice(action.toIndex, 0, doc);
      return copy;
    }
  }
}

function isCursor<T>(cursor: unknown): cursor is Cursor<T> {
  return cursor instanceof Mongo.Cursor;
}

// Synchronous fetch through `observe`, as upstream does, because synchronous `fetch` is deprecated.
function fetchData<T>(cursor: Cursor<T>): T[] {
  const data: T[] = [];
  const observer = cursor.observe({
    addedAt(document, atIndex) {
      data.splice(atIndex, 0, document);
    },
  });
  observer.stop();
  return data;
}

// Runs the effect during render so the first paint has data; cleans up if the render never commits.
function useSyncEffect(effect: () => (() => void) | undefined, deps: DependencyList): void {
  const [cleanup, timeoutId] = useMemo(() => {
    const cleanupFn = effect();
    const id = setTimeout(() => cleanupFn?.(), 1000);
    return [cleanupFn, id] as const;
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are provided by the caller
  }, deps);

  useEffect(() => {
    clearTimeout(timeoutId);
    return cleanup;
  }, [cleanup, timeoutId]);
}

/** Reactive, fine-grained list of the documents of a cursor. */
export function useFind<T>(
  factory: () => Cursor<T> | null | undefined,
  deps: DependencyList,
): T[] | null | undefined {
  const cursor = useMemo(() => {
    // Opt out of Tracker so render has no side effects.
    const value = Tracker.nonreactive(factory);
    if (Meteor.isDevelopment && value != null && !isCursor(value)) {
      console.warn("meteor-rpc: useFind expected a Mongo.Cursor. Don't call .fetch() on it.");
    }
    return value;
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are provided by the caller
  }, deps);

  const [data, dispatch] = useReducer(
    (state: T[], action: Action<T>) => reducer(state, action),
    null,
    () => (isCursor<T>(cursor) ? fetchData(cursor) : []),
  );

  useSyncEffect(() => {
    if (!isCursor<T>(cursor)) return undefined;
    dispatch({ type: "refresh", data: fetchData(cursor) });
    const observer = cursor.observe({
      addedAt(document, atIndex) {
        dispatch({ type: "addedAt", document, atIndex });
      },
      changedAt(newDocument, _oldDocument, atIndex) {
        dispatch({ type: "changedAt", document: newDocument, atIndex });
      },
      removedAt(_oldDocument, atIndex) {
        dispatch({ type: "removedAt", atIndex });
      },
      movedTo(_document, fromIndex, toIndex) {
        dispatch({ type: "movedTo", fromIndex, toIndex });
      },
      _suppress_initial: true,
    });
    return () => observer.stop();
  }, [cursor]);

  return cursor ? data : cursor;
}
