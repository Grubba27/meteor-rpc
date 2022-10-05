import { z } from "zod";
import { Config, Resolver, ReturnMethod, ReturnSubscription } from "../types";
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
        <Schema extends z.ZodUndefined | z.ZodTypeAny, Result, Resolvers extends Partial<Submodules> >
        (resolvers: Resolvers) => {
          Object.keys(resolvers).forEach((key: keyof Submodules & keyof Resolvers & string) => {
            const resolver = resolvers[key] as (args: z.input<Schema>) => Result ;
            if (subModules === undefined) {
              throw new Error(`Resolver ${ key } is not defined`)
            }
            const method = subModules[key] as ReturnMethod<RouteName extends undefined ? typeof key : `${ RouteName }.${ typeof key }`, Schema, Result>;
            if (subModules[key]) {
              if (resolver === undefined) {
                throw new Error(`Resolver ${ key } is not defined`)
              }
              method.setResolver(resolver);
            }
          })
        }

      return [
        subModules as Submodules extends infer O ? { [K in keyof O]: O[K] } : never,
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
