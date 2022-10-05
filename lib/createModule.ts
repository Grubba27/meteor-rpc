import { z } from "zod";
import { Config, ReturnMethod, ReturnSubscription } from "../types";
import { createMethod, createPublication } from "../server-main";
import { Meteor, Subscription as MeteorSubscription } from 'meteor/meteor'


export const createModule =
  <RouteName extends string | undefined, Submodules extends Record<string, unknown> = {}>
  (prefix?: RouteName, subModules?: Submodules) => {
    const addMethod =
      <Name extends string, Schema extends z.ZodUndefined | z.ZodTypeAny, T>
      (name: Name,
       schema: Schema,
       resolver:
         (this: Meteor.MethodThisType, args: z.output<Schema>) => T,
       config?: Config<Schema, T>) => {
        const nameWithPrefix = prefix ? `${ prefix }.${ name }` : name;
        const obj = { [name]: createMethod(nameWithPrefix, schema, resolver, config) };
        return createModule<RouteName, Submodules & Record<Name, ReturnMethod<RouteName extends undefined ? Name : `${ RouteName }.${ Name }`, Schema, T>>>(prefix, {
          ...subModules,
          ...obj
        } as Submodules & Record<Name, ReturnMethod<RouteName extends undefined ? Name : `${ RouteName }.${ Name }`, Schema, T>>)
      }

    const addPublication =
      <Name extends string, Schema extends z.ZodUndefined | z.ZodTypeAny, T, UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined ? [] : [z.input<Schema>]>
      (name: Name,
       schema: Schema,
       resolver:
         (this: MeteorSubscription, args: UnwrappedArgs) => T,
       config?: Config<UnwrappedArgs, T>) => {
        const nameWithPrefix = prefix ? `${ prefix }.${ name }` : name;
        const obj = { [name]: createPublication(nameWithPrefix, schema, resolver, config) };
        return createModule<RouteName, Submodules & Record<Name, ReturnSubscription<RouteName extends undefined ? Name : `${ RouteName }.${ Name }`, Schema, T>>>(prefix, {
          ...subModules,
          ...obj
        } as Submodules & Record<Name, ReturnSubscription<RouteName extends undefined ? Name : `${ RouteName }.${ Name }`, Schema, T>>)
      }



    const build =
      () => subModules as Submodules extends infer O ? { [K in keyof O]: O[K] } : never;

    const safeBuild = () => {
      const setResolvers =
        <S extends z.ZodUndefined | z.ZodTypeAny,
          Result,
          Resolvers extends Partial<Record<string, <S extends z.ZodUndefined | z.ZodTypeAny, Result>(args: z.input<S>) => Result>>>
        (resolvers: Resolvers) => {
          Object.keys(resolvers).forEach((key: keyof Submodules & keyof Resolvers & string) => {
            const resolver = resolvers[key];
            if (subModules === undefined) {
              throw new Error(`Resolver ${ key } is not defined`)
            }
            const method = subModules[key] as ReturnMethod<`${ RouteName }.${ typeof key }`, S, Result>;
            if (subModules[key]) {
              if (resolver === undefined) {
                throw new Error(`Resolver ${ key } is not defined`)
              }
              method.setResolver(resolver);
            }
          })
        }
      return [
        build(),
        setResolvers
      ]
    }

    const addMutation = addMethod;
    const addQuery = addMethod;
    return {
      addMethod,
      addMutation,
      addQuery,
      addPublication,
      build,
      safeBuild
    }
  }
