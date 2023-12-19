import { createMethod } from "./createMethod";
import { Meteor } from "meteor/meteor";
import { z } from "zod";
import { useSuspenseQuery } from "@tanstack/react-query";
import {  useMutation as useMutationRQ } from "@tanstack/react-query";

type M = ReturnType<typeof createMethod>;
type R = Record<string, M>;

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
export const createClient = <T>() => createProxyClient<T>() as T;

const createProxyClient = <T extends R, Prop = keyof T>(
  path: string[] = []
) => {
  const proxy = new Proxy(
    {},
    {
      get(_, key: string) {
        if (typeof key !== "string" || key === "then" || key === "toJSON") {
          // special case for if the proxy is accidentally treated
          // like a PromiseLike (like in `Promise.resolve(proxy)`)
          return undefined;
        }
        return createProxyClient([...path, key]);
      },
      apply(_1, _2, args) {
        const lastArg = args[args.length - 1];
        if (lastArg === "useQuery" || lastArg === "useMutation") {
          args.pop();
        }
        const name = path.join(".");

        function call(...params) {
          return new Promise((resolve, reject) => {
            Meteor.call(name, ...params, (err: null | Meteor.Error, result: any) => {
              if (err) {
                reject(err);
              } else {
                resolve(result);
              }
            });
          });
        }

        if (lastArg === "useQuery") {
          return useSuspenseQuery({
            queryKey: [name, ...args],
            queryFn: () => call(...args)
          });
        }

        if (lastArg === "useMutation") {
          return useMutationRQ({
            mutationFn: (params) => call(params),
          });
        }

        return call(...args);
      },
    }
  ) as T;

  return proxy;
};

