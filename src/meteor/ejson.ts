import { fromPackage } from "./package.js";

export interface EJSONStatic {
  stringify(value: unknown, options?: { canonical?: boolean }): string;
}

/** The `EJSON` namespace, narrowed to what meteor-rpc uses. Every access reads `Package.ejson`. */
export const EJSON: EJSONStatic = {
  stringify: (value, options) => load().stringify(value, options),
};

function load(): EJSONStatic {
  return fromPackage<EJSONStatic>("ejson", "EJSON");
}
