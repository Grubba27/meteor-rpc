import { createClient } from "meteor-rpc";

export const api = createClient();

export const Count = () => {
  const { data } = api.todos.count.useSuspenseQuery();
  return <span>{data}</span>;
};
