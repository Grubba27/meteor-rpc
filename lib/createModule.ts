import { Schema, z } from "zod";
import {
  Config,
  Resolver,
  ReturnMethod,
  ReturnSubscription,
} from "../types";
import { createMethod, createPublication } from "../server-main";
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";

export const createModule = <
  RouteName extends string | undefined,
  Submodules extends Record<string, unknown> = {}
>(
  prefix?: RouteName,
  subModules?: Submodules
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
    >(prefix, {
      ...subModules,
      ...obj,
    } as Submodules & Record<Name, ReturnMethod<RouteName extends undefined ? Name : `${RouteName}.${Name}`, Schema, T>>);
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
    resolver: (this: MeteorSubscription, args: UnwrappedArgs) => T,
    config?: Config<UnwrappedArgs, T>
  ) => {
    const nameWithPrefix = prefix ? `${prefix}.${name}` : name;
    const obj = {
      [name]: createPublication(nameWithPrefix, schema, resolver, config),
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
    >(prefix, {
      ...subModules,
      ...obj,
    } as Submodules & Record<Name, ReturnSubscription<RouteName extends undefined ? Name : `${RouteName}.${Name}`, Schema, T>>);
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
    return createModule<RouteName, Submodules & Record<Name, T>>(prefix, {
      ...subModules,
      ...obj,
    } as Submodules & Record<Name, T>);
  };

  let __middlewares: Array<(raw: unknown, parsed: unknown) => void> = [];

  const middlewares = (fns: Array<(raw: unknown, parsed: unknown) => void>) => {
    __middlewares.push(...fns);
    return createModule<RouteName, Submodules>(prefix, subModules);
  };

  const _applyMiddlewares = () => {
    if (!subModules) throw new Error("no keys");
    for (const name of Object.keys(subModules)) {
      const method = subModules[name];
      // @ts-ignore
      if (method.addBeforeResolveHook) {
        for (const fn of __middlewares) {
          // @ts-ignore
          method.addBeforeResolveHook(fn);
        }
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

  const safeBuild = () => {
    const setResolvers =
      // @ts-ignore
      <
        Schema extends z.ZodUndefined | z.ZodTypeAny,
        Result,
        Resolvers extends Partial<{
          [k in keyof Submodules]: (
            args: z.input<Submodules[k]["config"]["schema"]>
          ) => Submodules[k]["config"]["__result"];
        }>
      >(
        resolvers: Resolvers
      ) => {
        Object.keys(resolvers).forEach(
          (key: keyof Submodules & keyof Resolvers & string) => {
            const resolver = resolvers[key] as (
              args: z.input<Schema>
            ) => Result;
            if (subModules === undefined) {
              throw new Error(`Resolver ${key} is not defined`);
            }
            const method = subModules[key] as ReturnMethod<
              RouteName extends undefined
                ? typeof key
                : `${RouteName}.${typeof key}`,
              Schema,
              Result
            >;
            if (subModules[key]) {
              if (resolver === undefined) {
                throw new Error(`Resolver ${key} is not defined`);
              }
              method.setResolver(resolver);
            }
          }
        );
      };

    return [
      subModules as Submodules extends infer O
        ? { [K in keyof O]: O[K] }
        : never,
      setResolvers,
    ] as const;
  };

  const addMutation = addMethod;
  const addQuery = addMethod;
  return {
    addMethod,
    addSubmodule,
    addMutation,
    addQuery,
    addPublication,
    build,
    safeBuild,
    buildSubmodule,
    middlewares,
  };
};


