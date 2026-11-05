// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { api as client } from "../api/client";

export const Relative = () => {
  const { data } = client.todos.count.useQuery();
  return <p>{data}</p>;
};
