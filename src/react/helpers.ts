import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { coreHelpers } from "../client/helpers.js";
import type { Helper } from "../client/proxy.js";
import type { Transport } from "../client/transport.js";
import { usePublication } from "./use-publication.js";

type Options = Record<string, unknown> | undefined;

function queryKey(path: string, input: unknown): readonly unknown[] {
  return input === undefined ? [path] : [path, input];
}

function queryOptions(transport: Transport, path: string, args: unknown[]) {
  const input = args[0];
  return {
    ...(args[1] as Options),
    queryKey: queryKey(path, input),
    queryFn: () => transport.call(path, input),
  };
}

function mutationOptions(transport: Transport, path: string, args: unknown[]) {
  return {
    ...(args[0] as Options),
    mutationKey: [path],
    mutationFn: (input: unknown) => transport.call(path, input),
  };
}

/** Helpers of the React client: the core helpers plus TanStack Query and publication hooks. */
export const reactHelpers: Readonly<Record<string, Helper>> = {
  ...coreHelpers,
  queryKey: (_transport, path, args) => queryKey(path, args[0]),
  queryOptions,
  mutationOptions,
  useQuery: (transport, path, args) => useQuery(queryOptions(transport, path, args)),
  useSuspenseQuery: (transport, path, args) =>
    useSuspenseQuery(queryOptions(transport, path, args)),
  useMutation: (transport, path, args) => useMutation(mutationOptions(transport, path, args)),
  usePublication: (transport, path, args) => usePublication(transport, path, args[0]),
};
