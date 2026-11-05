// Meteor runs server-side npm code with plain Node, which can't resolve `meteor/*`
// imports. So meteor-rpc never imports them: it reads each Meteor package's exports
// from the `Package` global, which Meteor fills before app code (and node_modules) runs.
// Lookups happen on first use, so an optional package is only needed if you use it.

declare const Package: Record<string, Record<string, unknown> | undefined> | undefined;

/** Reads `exportName` from a Meteor package, or throws an actionable error. */
export function fromPackage<T>(packageName: string, exportName: string, hint?: string): T {
  const value = typeof Package === "undefined" ? undefined : Package[packageName]?.[exportName];
  if (value === undefined) {
    throw new Error(
      `meteor-rpc: ${exportName} from the "${packageName}" Meteor package is not available. ` +
        (hint ?? "meteor-rpc only runs inside a Meteor app."),
    );
  }
  return value as T;
}
