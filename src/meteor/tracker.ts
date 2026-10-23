import { fromPackage } from "./package.js";

export interface Computation {
  readonly firstRun: boolean;
  stop(): void;
}

export interface TrackerStatic {
  autorun(run: (computation: Computation) => void): Computation;
  nonreactive<T>(fn: () => T): T;
}

/** The `Tracker` namespace, narrowed to what meteor-rpc uses. Every access reads `Package.tracker`. */
export const Tracker: TrackerStatic = {
  autorun: (run) => load().autorun(run),
  nonreactive: (fn) => load().nonreactive(fn),
};

function load(): TrackerStatic {
  return fromPackage<TrackerStatic>("tracker", "Tracker");
}
