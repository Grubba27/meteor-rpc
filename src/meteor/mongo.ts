import { fromPackage } from "./package.js";
import type { ConnectionLike } from "./types.js";

export interface ObserveCallbacks<TDoc> {
  addedAt?(document: TDoc, atIndex: number, before: unknown): void;
  changedAt?(newDocument: TDoc, oldDocument: TDoc, atIndex: number): void;
  removedAt?(oldDocument: TDoc, atIndex: number): void;
  movedTo?(document: TDoc, fromIndex: number, toIndex: number, before: unknown): void;
  /** Private Meteor option: skip the initial `addedAt` calls. */
  _suppress_initial?: boolean;
}

export interface ObserveChangesCallbacks {
  added?(id: string, fields: Record<string, unknown>): void;
  changed?(id: string, fields: Record<string, unknown>): void;
  removed?(id: string): void;
}

export interface LiveQueryHandle {
  stop(): void;
}

/** A Mongo cursor as seen by meteor-rpc (server or client). */
export interface Cursor<TDoc = unknown> {
  fetch(): TDoc[];
  observe(callbacks: ObserveCallbacks<TDoc>): LiveQueryHandle;
  observeChanges(
    callbacks: ObserveChangesCallbacks,
    options?: { nonMutatingCallbacks?: boolean },
  ): LiveQueryHandle | Promise<LiveQueryHandle>;
  observeChangesAsync?(
    callbacks: ObserveChangesCallbacks,
    options?: { nonMutatingCallbacks?: boolean },
  ): Promise<LiveQueryHandle>;
}

export interface Collection<TDoc = unknown> {
  find(selector?: unknown, options?: unknown): Cursor<TDoc>;
  findOne(selector?: unknown, options?: unknown): TDoc | undefined;
  findOneAsync(selector?: unknown, options?: unknown): Promise<TDoc | undefined>;
}

export interface CollectionOptions {
  connection?: ConnectionLike | null;
  defineMutationMethods?: boolean;
}

export interface MongoStatic {
  Collection: new <TDoc>(name: string, options?: CollectionOptions) => Collection<TDoc>;
  Cursor: abstract new (...args: never[]) => Cursor;
}

/** The `Mongo` namespace, narrowed to what meteor-rpc uses. Every access reads `Package.mongo`. */
export const Mongo: MongoStatic = {
  get Collection() {
    return load().Collection;
  },
  get Cursor() {
    return load().Cursor;
  },
};

function load(): MongoStatic {
  return fromPackage<MongoStatic>(
    "mongo",
    "Mongo",
    "Publications need the mongo package: `meteor add mongo`.",
  );
}
