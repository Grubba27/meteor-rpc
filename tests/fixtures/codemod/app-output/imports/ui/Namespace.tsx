// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import * as rpcClient from "../api/client.js";

export const Namespace = () => {
  const { data } = rpcClient.api.todos.count.useSuspenseQuery();
  return <p>{data}</p>;
};
