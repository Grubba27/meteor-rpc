import { createMethod } from "./createMethod";
import { Meteor } from "meteor/meteor";
import { z } from "zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMutation as useMutationRQ } from "@tanstack/react-query";
import { useSubscribe } from "./utils/hooks/useSubscribe";
import useFind from "./utils/hooks/useFind";
import { Mongo } from "meteor/mongo";
type M = ReturnType<typeof createMethod>;
type R = Record<string, M>;
const collectionMap = new Map<string, Mongo.Collection<any>>();
export const createSafeCaller = <T extends R>() => {
  return {
    call<P extends keyof T>(
      name: T[P]["config"]["name"],
      args: z.input<T[P]["config"]["schema"]>
    ): Promise<T[P]["config"]["__result"]> {
      return new Promise((resolve, reject) => {
        Meteor.call(name, args, (err: null | Meteor.Error, result: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });
    },
  };
};

// @ts-ignore
export const createClient = <T, t>(target: t) => createProxyClient<T>() as T & t;

const createProxyClient = <T extends R, Prop = keyof T>(
  path: string[] = [],
) => {
  const proxy = new Proxy(
    () => {},
    {
      get(_, key: string) {
        if (typeof key !== "string" || key === "then" || key === "toJSON" || key === "prototype") {
          // special case for if the proxy is accidentally treated
          // like a PromiseLike (like in `Promise.resolve(proxy)`)
          return undefined;
        }
        return createProxyClient([...path, key]);
      },
      apply(_1, _2, args) {
        const lastPath = path.at(-1);
        if (
          lastPath === "useQuery" ||
          lastPath === "useMutation" ||
          lastPath === "usePublication"
        ) {
          path = path.slice(0, -1);
        }

        const name = path.join(".");
        // @ts-ignore
        async function call(...params) {
          // @ts-ignore
          const result = await Meteor.callAsync(name, ...params);
          if (result && Object.hasOwn(result, "__isError__")) {
            throw new Meteor.Error(result.error, result.reason);
          }

          if (
            result &&
            Object.hasOwn(result, "errorType") &&
            result.errorType === "Meteor.Error"
          ) {
            throw new Meteor.Error(result.error, result.reason);
          }

          return result;
        }
        if (lastPath === "useQuery") {
          const lastArg = args.at(-1);
          if (typeof lastArg === "object" && lastArg?.useQueryOptions) {
            const __args = args.slice(0, -1);
            return useSuspenseQuery({
              ...lastArg.useQueryOptions,
              queryKey: [name, ...__args],
              queryFn: () => call(...__args),
            });
          }
          return useSuspenseQuery({
            queryKey: [name, ...args],
            queryFn: () => call(...args),
          });
        }

        if (lastPath === "useMutation") {
          const lastArg = args.at(-1);
          if (typeof lastArg === "object") {
            return useMutationRQ({
              ...lastArg,
              mutationFn: (params) => call(params),
            });
          }
          return useMutationRQ({
            mutationFn: (params) => call(params),
          });
        }

        if (lastPath === "usePublication") {
          let coll: Mongo.Collection<any>;
          if (collectionMap.has(name)) {
            coll = collectionMap.get(name) as Mongo.Collection<any>;
          } else {
            coll = new Mongo.Collection(name);
            collectionMap.set(name, coll);
          }

          useSubscribe(name, ...args);
          return useFind(() => coll.find(), []);
        }

        return call(...args);
      },
    }
  ) as unknown as T;

  return proxy;
};
