// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { rpc } from "/imports/api";

export const Barrel = () => {
  const { data } = rpc.todos.count.useSuspenseQuery();
  return <p>{data}</p>;
};
