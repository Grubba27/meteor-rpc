import { Meteor } from "../meteor/meteor.js";
import { nameError } from "../shared/names.js";
import { type AnySchema, assertStandardSchema } from "../shared/schema.js";
import type {
  Definition,
  MethodConfig,
  Middleware,
  PublicationConfig,
  RouterRecord,
} from "../shared/types.js";
import { registerModule } from "./register.js";
import type { ModuleBuilder } from "./types.js";

export type AnyResolver = (this: any, input: any, context: any) => unknown;

export interface MethodEntry {
  readonly kind: "method";
  readonly name: string;
  readonly schema: AnySchema;
  readonly resolver: AnyResolver;
  readonly config: MethodConfig<any, any> | undefined;
}

export interface PublicationEntry {
  readonly kind: "publication";
  readonly shape: "cursor" | "record";
  readonly name: string;
  readonly schema: AnySchema;
  readonly resolver: AnyResolver;
  readonly config: PublicationConfig<any, any> | undefined;
}

export interface SubmoduleEntry {
  readonly kind: "submodule";
  readonly name: string;
  readonly state: ModuleState;
}

export type Entry = MethodEntry | PublicationEntry | SubmoduleEntry;

/** Immutable description of a module. Every builder call creates a new state. */
export interface ModuleState {
  readonly prefix: string | undefined;
  readonly entries: readonly Entry[];
  readonly middlewares: readonly Middleware[];
}

const submoduleStates = new WeakMap<object, ModuleState>();
const builtRouters = new WeakMap<ModuleState, RouterRecord>();

function fail(message: string): never {
  throw new TypeError(`meteor-rpc: ${message}`);
}

function checkNewName(state: ModuleState, name: unknown): string {
  const error = nameError(name);
  if (error) fail(error);
  const value = name as string;
  if (state.entries.some((entry) => entry.name === value)) {
    fail(
      `"${value}" is already defined in ${state.prefix ? `module "${state.prefix}"` : "this module"}`,
    );
  }
  return value;
}

function checkResolver(name: string, resolver: unknown): AnyResolver {
  if (typeof resolver !== "function") fail(`the resolver of "${name}" must be a function`);
  return resolver as AnyResolver;
}

function toRouter(state: ModuleState): RouterRecord {
  const router: Record<string, Definition | RouterRecord> = {};
  for (const entry of state.entries) {
    router[entry.name] =
      entry.kind === "submodule"
        ? toRouter(entry.state)
        : (Object.freeze({ type: entry.kind }) as Definition);
  }
  return Object.freeze(router);
}

function builder(state: ModuleState): ModuleBuilder<any, any> {
  const withEntry = (entry: Entry) => builder({ ...state, entries: [...state.entries, entry] });

  const self: Omit<ModuleBuilder<any, any>, "~prefix"> = {
    addMethod(name: unknown, schema: unknown, resolver: unknown, config?: MethodConfig<any, any>) {
      const checked = checkNewName(state, name);
      assertStandardSchema(schema, checked);
      return withEntry({
        kind: "method",
        name: checked,
        schema,
        resolver: checkResolver(checked, resolver),
        config,
      });
    },
    addPublication(
      name: unknown,
      schema: unknown,
      resolver: unknown,
      config?: PublicationConfig<any, any>,
    ) {
      const checked = checkNewName(state, name);
      assertStandardSchema(schema, checked);
      return withEntry({
        kind: "publication",
        shape: "cursor",
        name: checked,
        schema,
        resolver: checkResolver(checked, resolver),
        config,
      });
    },
    addSharedPublication(
      name: unknown,
      schema: unknown,
      resolver: unknown,
      config?: PublicationConfig<any, any>,
    ) {
      const checked = checkNewName(state, name);
      assertStandardSchema(schema, checked);
      return withEntry({
        kind: "publication",
        shape: "record",
        name: checked,
        schema,
        resolver: checkResolver(checked, resolver),
        config,
      });
    },
    addSubmodule(submodule: object) {
      const subState =
        typeof submodule === "object" && submodule !== null
          ? submoduleStates.get(submodule)
          : undefined;
      if (!subState?.prefix) {
        fail('addSubmodule expects the result of createModule("namespace")...buildSubmodule()');
      }
      return withEntry({
        kind: "submodule",
        name: checkNewName(state, subState.prefix),
        state: subState,
      });
    },
    addMiddlewares(middlewares: ReadonlyArray<Middleware>) {
      if (!Array.isArray(middlewares) || middlewares.some((fn) => typeof fn !== "function")) {
        fail("addMiddlewares expects an array of functions");
      }
      return builder({ ...state, middlewares: [...state.middlewares, ...middlewares] });
    },
    build() {
      if (state.prefix !== undefined) {
        fail(
          `module "${state.prefix}" is a submodule: call buildSubmodule() and add it to the root module with addSubmodule()`,
        );
      }
      const existing = builtRouters.get(state);
      if (existing) return existing;
      if (Meteor.isServer) registerModule(state);
      const router = toRouter(state);
      builtRouters.set(state, router);
      return router;
    },
    buildSubmodule() {
      if (state.prefix === undefined) {
        fail('buildSubmodule() needs a namespace: createModule("namespace")');
      }
      const submodule = Object.freeze({ name: state.prefix, submodule: toRouter(state) });
      submoduleStates.set(submodule, state);
      return submodule;
    },
  } as Omit<ModuleBuilder<any, any>, "~prefix">;

  return self as ModuleBuilder<any, any>;
}

/**
 * Starts a module.
 *
 * - `createModule()` is the root module: finish it with `build()` and `export type Server = typeof server`.
 * - `createModule("chat")` is a submodule: finish it with `buildSubmodule()` and pass it to `addSubmodule`.
 */
export function createModule(): ModuleBuilder<undefined, {}>;
export function createModule<TPrefix extends string>(prefix: TPrefix): ModuleBuilder<TPrefix, {}>;
export function createModule(prefix?: string): ModuleBuilder<string | undefined, {}> {
  if (prefix !== undefined) {
    const error = nameError(prefix);
    if (error) fail(error);
  }
  return builder({ prefix, entries: [], middlewares: [] });
}
