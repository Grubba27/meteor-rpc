import { Schema, z } from "zod";
import { Config, Resolver, ReturnMethod, ReturnSubscription } from "../types";
import { createMethod, createPublication } from "../server-main";
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";
import { createRealtimeQuery } from "./createRealtimeQuery";
import { Mongo } from "meteor/mongo";

export const createModule = <
  RouteName extends string | undefined,
  Submodules extends Record<string, unknown> = {}
>(
  prefix?: RouteName,
  subModules?: Submodules,
  middlewares: Array<(raw: unknown, parsed: unknown) => void> = []
) => {
  const addMethod = <
    Name extends string,
    Schema extends z.ZodUndefined | z.ZodTypeAny,
    T
  >(
    name: Name,
    schema: Schema,
    resolver: (this: Meteor.MethodThisType, args: z.output<Schema>) => T,
    config?: Config<Schema, T>
  ) => {
    const nameWithPrefix = prefix ? `${prefix}.${name}` : name;
    const obj = {
      [name]: createMethod(nameWithPrefix, schema, resolver, config),
    };
    return createModule<
      RouteName,
      Submodules &
        Record<
          Name,
          ReturnMethod<
            RouteName extends undefined ? Name : `${RouteName}.${Name}`,
            Schema,
            T
          >
        >
    >(
      prefix,
      {
        ...subModules,
        ...obj,
      } as Submodules &
        Record<
          Name,
          ReturnMethod<
            RouteName extends undefined ? Name : `${RouteName}.${Name}`,
            Schema,
            T
          >
        >,
      middlewares
    );
  };

  const addPublication = <
    Name extends string,
    Schema extends z.ZodUndefined | z.ZodTypeAny,
    T,
    UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined
      ? []
      : [z.input<Schema>]
  >(
    name: Name,
    schema: Schema,
    resolver: (this: MeteorSubscription, args: UnwrappedArgs) => Mongo.Cursor<T>,
    config?: Config<UnwrappedArgs, T>
  ) => {
    const nameWithPrefix = prefix ? `${prefix}.${name}` : name;
    const obj = {
      [name]: createRealtimeQuery(nameWithPrefix, schema, resolver, config),
    };
    return createModule<
      RouteName,
      Submodules &
        Record<
          Name,
          ReturnSubscription<
            RouteName extends undefined ? Name : `${RouteName}.${Name}`,
            Schema,
            T
          >
        >
    >(
      prefix,
      {
        ...subModules,
        ...obj,
      } as Submodules &
        Record<
          Name,
          ReturnSubscription<
            RouteName extends undefined ? Name : `${RouteName}.${Name}`,
            Schema,
            T
          >
        >,
      middlewares
    );
  };

  const addSubmodule = <
    Name extends string,
    T extends Record<string, unknown>
  >({
    name,
    submodule,
  }: {
    name: Name;
    submodule: T;
  }) => {
    const obj = { [name]: submodule };
    return createModule<RouteName, Submodules & Record<Name, T>>(
      prefix,
      {
        ...subModules,
        ...obj,
      } as Submodules & Record<Name, T>,
      middlewares
    );
  };

  const addMiddlewares = (
    fns: Array<(raw: unknown, parsed: unknown) => void>
  ) => {
    return createModule<RouteName, Submodules>(prefix, subModules, [
      ...middlewares,
      ...fns,
    ]);
  };

  const _addHookToMethod = (method: any) => {
    if (method.addBeforeResolveHook) {
      for (const fn of middlewares) {
        // @ts-ignore
        method.addBeforeResolveHook(fn);
      }
    }
  };
  const _addToObjectRecursively = (obj: any) => {
    for (const name of Object.keys(obj)) {
      const methodOrModule = obj[name];
      if (typeof methodOrModule === "object") {
        // now is module
        // recursively call _addHookToMethod
        _addToObjectRecursively(methodOrModule);
      }
      _addHookToMethod(methodOrModule);
    }
  };
  const _applyMiddlewares = () => {
    if (!subModules) throw new Error("no keys");
    for (const name of Object.keys(subModules)) {
      const methodOrModule = subModules[name];
      // @ts-ignore
      _addHookToMethod(methodOrModule);

      if (typeof methodOrModule === "object") {
        // now is module
        // recursively call _addHookToMethod
        _addToObjectRecursively(methodOrModule);
      }
    }
  };

  const build = () => {
    _applyMiddlewares();
    return subModules as unknown as Submodules extends infer O
      ? { [K in keyof O]: O[K] }
      : never;
  };

  const buildSubmodule = () => {
    const name = prefix as unknown as RouteName extends undefined
      ? never
      : RouteName;
    return {
      name: name,
      submodule: build(),
    };
  };

  return {
    addMethod,
    addSubmodule,
    addPublication,
    build,
    buildSubmodule,
    addMiddlewares,
  };
};
