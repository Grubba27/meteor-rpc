import { fromPackage } from "./package.js";
import type {
  ConnectionLike,
  MeteorErrorLike,
  MethodInvocation,
  Subscription,
  SubscriptionHandle,
} from "./types.js";

export interface MeteorErrorConstructor {
  new (error: string | number, reason?: string, details?: unknown): MeteorErrorLike;
}

export interface MeteorStatic {
  readonly isServer: boolean;
  readonly isClient: boolean;
  readonly isDevelopment: boolean;
  readonly Error: MeteorErrorConstructor;
  readonly connection?: ConnectionLike | undefined;
  methods(methods: Record<string, (this: MethodInvocation, ...args: unknown[]) => unknown>): void;
  publish(name: string, handler: (this: Subscription, ...args: unknown[]) => unknown): void;
  callAsync(name: string, ...args: unknown[]): Promise<unknown>;
  subscribe(name: string, ...args: unknown[]): SubscriptionHandle;
}

/** The `Meteor` object, narrowed to what meteor-rpc uses. Every access reads `Package.meteor`. */
export const Meteor: MeteorStatic = {
  get isServer() {
    return load().isServer;
  },
  get isClient() {
    return load().isClient;
  },
  get isDevelopment() {
    return load().isDevelopment;
  },
  get Error() {
    return load().Error;
  },
  get connection() {
    return load().connection;
  },
  methods: (methods) => load().methods(methods),
  publish: (name, handler) => load().publish(name, handler),
  callAsync: (name, ...args) => load().callAsync(name, ...args),
  subscribe: (name, ...args) => load().subscribe(name, ...args),
};

function load(): MeteorStatic {
  return fromPackage<MeteorStatic>("meteor", "Meteor");
}
