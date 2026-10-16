import { createClient } from "meteor/grubba:rpc";

export const api = createClient();

export const Count = () => {
  const { data } = api.todos.count.useQuery();
  return <span>{data}</span>;
};
