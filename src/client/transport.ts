import { Meteor } from "../meteor/meteor.js";
import { type Collection, Mongo } from "../meteor/mongo.js";
import type { ConnectionLike, SubscribeCallbacks, SubscriptionHandle } from "../meteor/types.js";

/** How a client reaches the server. One transport per `createClient` call. */
export interface Transport {
  /** The DDP connection object, used as the cache key for collections and subscriptions. */
  readonly connection: object;
  call(name: string, input: unknown): Promise<unknown>;
  subscribe(name: string, input: unknown, callbacks?: SubscribeCallbacks): SubscriptionHandle;
  collection<TDoc>(name: string): Collection<TDoc>;
  /** False while server-side rendering with the default connection. */
  readonly canSubscribe: boolean;
}

// One registry per connection: Meteor throws if two collections share a name on one connection.
const registries = new WeakMap<object, Map<string, Collection<any>>>();

export function createTransport(custom?: ConnectionLike): Transport {
  const connection: ConnectionLike = custom ?? Meteor;
  const canSubscribe = custom !== undefined || Meteor.isClient;

  return {
    connection,
    canSubscribe,
    call(name, input) {
      if (typeof connection.callAsync !== "function") {
        return Promise.reject(
          new Error("meteor-rpc: this connection has no callAsync(); meteor-rpc needs Meteor 3."),
        );
      }
      // Never send `undefined`: DDP turns it into `null`, which `z.void()` rejects.
      return input === undefined ? connection.callAsync(name) : connection.callAsync(name, input);
    },
    subscribe(name, input, callbacks) {
      if (!canSubscribe) {
        throw new Error(
          "meteor-rpc: subscriptions need a client. On the server, pass a DDP connection: createClient({ connection: DDP.connect(url) }).",
        );
      }
      const args: unknown[] = input === undefined ? [] : [input];
      if (callbacks) args.push(callbacks);
      return connection.subscribe(name, ...args);
    },
    collection<TDoc>(name: string): Collection<TDoc> {
      if (!canSubscribe) {
        throw new Error(
          "meteor-rpc: publication data only exists on the client. On the server, pass a DDP connection to createClient.",
        );
      }
      let registry = registries.get(connection);
      if (!registry) {
        registry = new Map();
        registries.set(connection, registry);
      }
      let collection = registry.get(name);
      if (!collection) {
        collection = new Mongo.Collection<TDoc>(name, {
          ...(custom ? { connection: custom } : {}),
          defineMutationMethods: false,
        });
        registry.set(name, collection);
      }
      return collection as Collection<TDoc>;
    },
  };
}
