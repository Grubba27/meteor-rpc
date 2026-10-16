import type { Transport } from "./transport.js";

// `Object.hasOwn` is ES2022; the build targets ES2020.
const hasOwn = (object: object, key: string): boolean =>
  // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is not available in ES2020
  Object.prototype.hasOwnProperty.call(object, key);

/** A client helper such as `subscribe` or `useQuery`: receives the dotted path of the definition. */
export type Helper = (transport: Transport, path: string, args: unknown[]) => unknown;

// Property names that must never become path segments: promise detection,
// serialization, and inspection by React or dev tools.
const IGNORED = new Set([
  "then",
  "catch",
  "finally",
  "toJSON",
  "toString",
  "valueOf",
  "constructor",
  "prototype",
  "$$typeof",
  "asymmetricMatch",
  "nodeType",
]);

/**
 * Builds the client proxy. Property access only extends the path; calling resolves it:
 * `api.chat.send(input)` calls the method "chat.send", and `api.chat.rooms.subscribe()`
 * runs the `subscribe` helper for "chat.rooms". Every access creates a fresh proxy, so
 * storing `api.chat.send.useMutation` in a variable is safe.
 */
export function createProxy(
  transport: Transport,
  helpers: Readonly<Record<string, Helper>>,
  path: readonly string[] = [],
): unknown {
  return new Proxy(() => {}, {
    get(_target, key) {
      if (typeof key !== "string" || IGNORED.has(key)) return undefined;
      return createProxy(transport, helpers, [...path, key]);
    },
    apply(_target, _thisArg, args: unknown[]) {
      const last = path[path.length - 1];
      if (path.length > 1 && last !== undefined && hasOwn(helpers, last)) {
        return helpers[last]!(transport, path.slice(0, -1).join("."), args);
      }
      if (path.length === 0) throw new TypeError("meteor-rpc: call a method, e.g. api.myMethod()");
      return transport.call(path.join("."), args[0]);
    },
  });
}
