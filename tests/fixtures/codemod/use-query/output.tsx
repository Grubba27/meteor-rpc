// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { useQuery } from "@tanstack/react-query";
import { createClient } from "meteor-rpc";
import type { Server } from "/imports/api/server";
import { trpc } from "/imports/trpc";

export const api = createClient<Server>();

export function Todos({ filter }: { filter: string }) {
  // Suspends until the list is loaded.
  const { data: todos } = api.todos.list.useSuspenseQuery(filter);
  const { data: count } = api.todos.count.useSuspenseQuery(undefined, {
    staleTime: 1000, // keep it for a second
  });
  const useQueryOptions = { refetchInterval: 5000 };
  const { data: me } = api.users.me.useSuspenseQuery(undefined, useQueryOptions);
  const { data: total } = api.todos.count.useSuspenseQuery(filter, {});
  const { data: inline } = api.todos.list.useSuspenseQuery(filter, { retry: false });

  // Not migrated automatically: reported.
  const { data: extra } = api.todos.list.useQuery(filter, { useQueryOptions: {}, enabled: true });
  const options = { useQueryOptions: { retry: 1 } };
  const { data: indirect } = api.todos.list.useQuery(filter, options);

  // Not meteor-rpc: left alone.
  const plain = useQuery({ queryKey: ["todos"], queryFn: () => fetchTodos() });
  const viaTrpc = trpc.todos.list.useQuery(filter);

  return (
    <ul title={`${count} ${me.name} ${total} ${inline} ${extra} ${indirect} ${plain} ${viaTrpc}`}>
      {todos.map((todo) => (
        <li key={todo._id}>{todo.text}</li>
      ))}
    </ul>
  );
}
