import { createProxy } from "../client/proxy.js";
import { createTransport, type Transport } from "../client/transport.js";
import type { Caller, Router, Submodule } from "../shared/types.js";
import { modulePathOf } from "./module.js";

/**
 * Calls the methods of a module from server code, for example from another module's resolver:
 *
 * ```ts
 * const locked = await createCaller(customersModule).isCustomerLocked();
 * ```
 *
 * Calls go through `Meteor.callAsync`, so they're validated and run the middlewares and hooks,
 * with the current method's `userId`. Pass a `buildSubmodule()` result or the root router.
 *
 * Typed from the module itself: inside a module that is part of `Server`,
 * `createClient<Server>()` would make the `Server` type circular.
 */
export function createCaller<TName extends string, TRecord>(
  module: Submodule<TName, TRecord>,
): Caller<Router<TRecord>>;
export function createCaller<TRecord>(router: Router<TRecord>): Caller<Router<TRecord>>;
export function createCaller(module: object): unknown {
  // A submodule only knows its full name once the root module is built, so it's resolved per call.
  const pathOf = modulePathOf(module);
  // Created on first use, so a caller can be created at import time without Meteor.
  let base: Transport | undefined;
  const baseTransport = (): Transport => {
    if (!base) base = createTransport();
    return base;
  };
  const transport: Transport = {
    get connection() {
      return baseTransport().connection;
    },
    canSubscribe: false,
    async call(name, input) {
      return baseTransport().call([...pathOf(), name].join("."), input);
    },
    subscribe() {
      throw new TypeError("meteor-rpc: createCaller only calls methods");
    },
    collection() {
      throw new TypeError("meteor-rpc: createCaller only calls methods");
    },
  };
  // No helpers: every property is a method name or a namespace.
  return createProxy(transport, {});
}
