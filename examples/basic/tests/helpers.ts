import { DDP } from "meteor/ddp";
import { Meteor } from "meteor/meteor";
import { type ConnectionLike, createClient, type SubscriptionHandle } from "meteor-rpc/client";
import { Members, Messages, Rooms } from "/imports/api/collections";

/** A DDP connection from the server to itself: every call goes over a real websocket. */
export type Connection = ConnectionLike & {
  callAsync(name: string, ...args: unknown[]): Promise<unknown>;
  status(): { connected: boolean };
  disconnect(): void;
};

export async function waitFor(
  check: () => boolean | Promise<boolean>,
  what: string,
  timeout = 5000,
) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const open: Connection[] = [];

export async function connect(): Promise<Connection> {
  const connection = DDP.connect(Meteor.absoluteUrl()) as unknown as Connection;
  open.push(connection);
  await waitFor(() => connection.status().connected, "the DDP connection");
  return connection;
}

/** A typed client over its own DDP connection, exactly what an app's client gets. */
export async function newClient<TRouter>() {
  const connection = await connect();
  return { connection, api: createClient<TRouter>({ connection }) };
}

export function disconnectAll() {
  for (const connection of open.splice(0)) connection.disconnect();
}

/** Resolves with the handle once ready, rejects with the subscription error. */
export function ready(
  subscribe: (callbacks: { onReady(): void; onStop(error?: unknown): void }) => SubscriptionHandle,
): Promise<SubscriptionHandle> {
  return new Promise((resolve, reject) => {
    let handle: SubscriptionHandle | undefined;
    let isReady = false;
    handle = subscribe({
      onReady: () => {
        isReady = true;
        // onReady can fire before subscribe() returns when the subscription is reused.
        queueMicrotask(() => resolve(handle!));
      },
      onStop: (error) => {
        if (!isReady) reject(error ?? new Error("subscription stopped before it was ready"));
      },
    });
  });
}

/** Expects `promise` to reject and returns the error. */
export async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected a rejection, but the promise resolved");
}

export interface PublicationMeta {
  _id: string;
  shape: "cursor" | "record";
  keys?: string[];
}

/**
 * The meta document meteor-rpc publishes for a publication instance, read from the
 * `meteor-rpc:meta` collection that meteor-rpc itself registered on this connection.
 * (Registering a second collection with that name would get no data: the first one wins.)
 */
export async function metaDoc(connection: Connection, instance: string) {
  const stores = (connection as unknown as { _stores: Record<string, { _getCollection(): any }> })
    ._stores;
  const meta = stores["meteor-rpc:meta"]?._getCollection();
  return meta ? ((await meta.findOneAsync(instance)) as PublicationMeta | undefined) : undefined;
}

/** Name Meteor uses for a collection object (private, but stable for years). */
export const nameOf = (collection: unknown) => (collection as { _name: string })._name;

/** Publication instance id of a client collection: "chat.messages#k3x9..." for "meteor-rpc:pub:chat.messages#k3x9...". */
export const instanceOf = (collection: unknown) =>
  nameOf(collection)
    .replace(/^meteor-rpc:pub:/, "")
    .replace(/\/[^/#]+$/, "");

export async function resetDb() {
  await Promise.all([Rooms.removeAsync({}), Messages.removeAsync({}), Members.removeAsync({})]);
}
