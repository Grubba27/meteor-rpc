// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { api, notAClient } from "/imports/api/client";

export const Absolute = ({ filter }: { filter: string }) => {
  const { data } = api.todos.list.useSuspenseQuery(filter, { staleTime: 500 });
  const same = notAClient.todos.list.useQuery(filter);
  return <p>{`${data} ${same}`}</p>;
};
