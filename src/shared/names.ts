import { EJSON } from "../meteor/ejson.js";

// Names a method, publication or submodule can't use, because the client proxy
// gives them a meaning. Reserving whole families now (every `use*` hook name and
// every `$`-prefixed name) lets future versions add helpers without a breaking change.

/** Exact names reserved by the client proxy and by JavaScript itself. */
export const RESERVED_NAMES: readonly string[] = [
  "subscribe",
  "collection",
  "collections",
  "queryKey",
  "queryOptions",
  "mutationOptions",
  "then",
  "catch",
  "finally",
  "toJSON",
  "toString",
  "valueOf",
  "prototype",
  "constructor",
];

/** Type-level twin of the runtime rules in `nameError`. */
export type ReservedName =
  | "subscribe"
  | "collection"
  | "collections"
  | "queryKey"
  | "queryOptions"
  | "mutationOptions"
  | "then"
  | "catch"
  | "finally"
  | "toJSON"
  | "toString"
  | "valueOf"
  | "prototype"
  | "constructor"
  | `use${Capitalize<string>}`
  | `$${string}`;

/** Returns why `name` can't be used, or `undefined` when it's fine. */
export function nameError(name: unknown): string | undefined {
  if (typeof name !== "string" || name.length === 0) return "names must be non-empty strings";
  if (name.includes(".")) return `"${name}" contains a dot; use createModule("namespace") to nest`;
  if (RESERVED_NAMES.includes(name)) return `"${name}" is reserved by meteor-rpc`;
  if (/^use[A-Z]/.test(name))
    return `"${name}" is reserved: names starting with "use" + uppercase are hooks`;
  if (name.startsWith("$")) return `"${name}" is reserved: names starting with "$" are helpers`;
  return undefined;
}

// 53-bit string hash (cyrb53, public domain). Collisions only make two inputs share a
// client collection, so a fast non-cryptographic hash is enough.
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Identifies one publication call: its path plus a hash of the input exactly as sent
 * (canonical EJSON), so subscriptions with different inputs never share documents.
 * Client and server compute it from the same value, the raw input.
 */
export function publicationInstance(path: string, input: unknown): string {
  return input === undefined
    ? path
    : `${path}#${hash(EJSON.stringify(input, { canonical: true }))}`;
}

/** Client collection that holds the documents of a publication instance (or one key of it). */
export function publicationCollectionName(instance: string, key?: string): string {
  return key === undefined ? `meteor-rpc:pub:${instance}` : `meteor-rpc:pub:${instance}/${key}`;
}

/** Client collection describing the shape of each active publication instance. */
export const META_COLLECTION = "meteor-rpc:meta";

/** Document stored in `META_COLLECTION`, one per publication instance. */
export interface PublicationMeta {
  readonly _id: string;
  readonly shape: "cursor" | "record";
  readonly keys?: readonly string[];
}
