// React client: `meteor-rpc/react`, every hook and TanStack Query helper.
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ClientCollection,
  createClient,
  isValidationError,
  type ReactClient,
} from "meteor-rpc/react";
import { type ReactElement, Suspense, useState } from "react";
import { assert, type Equal, expectType } from "./expect.js";
import type { Member, Message, Server } from "./server.js";

const api: ReactClient<Server> = createClient<Server>();

type SendResult = { id: string; at: Date };

function Messages({ roomId }: { roomId: string }): ReactElement {
  const ping = api.ping.useQuery();
  assert<Equal<typeof ping, UseQueryResult<"pong", Error>>>();

  const label = api.chat.length.useQuery("abc", { staleTime: 1000, select: (n) => `${n}` });
  assert<Equal<typeof label.data, string | undefined>>();

  const page = api.page.useQuery({ page: 1 }, { enabled: roomId !== "" });
  assert<Equal<typeof page.data, number | undefined>>();

  const deep = api.outer.inner.deep.useSuspenseQuery();
  assert<Equal<typeof deep.data, "deep">>();

  const send = api.chat.send.useMutation({
    onSuccess: (result, variables) => {
      assert<Equal<typeof result, SendResult>>();
      assert<Equal<typeof variables.roomId, string>>();
    },
    onError: (error) => {
      if (isValidationError(error)) void error.details;
    },
  });
  assert<Equal<typeof send.data, SendResult | undefined>>();

  const pinger = api.ping.useMutation();
  const queryClient = useQueryClient();

  const { data, collection } = api.chat.messages.usePublication({ roomId });
  assert<Equal<typeof data, Message[]>>();
  assert<Equal<typeof collection, ClientCollection<Message>>>();

  const room = api.chat.room.usePublication(roomId);
  assert<Equal<typeof room.data.members, Member[]>>();
  assert<Equal<typeof room.collections.members, ClientCollection<Member>>>();
  const roomName = room.data.room.at(0)?.name;
  assert<Equal<typeof roomName, string | undefined>>();

  const onSend = (): void => {
    send.mutate({ roomId, text: "hi" });
    pinger.mutate();
    void queryClient.invalidateQueries({ queryKey: api.chat.length.queryKey() });
    void queryClient.prefetchQuery(api.chat.length.queryOptions("abc"));
    void queryClient.ensureQueryData(api.ping.queryOptions());
  };

  return (
    <section>
      <ul>
        {data.map((message) => (
          <li key={message._id}>{message.text}</li>
        ))}
      </ul>
      <button type="button" onClick={onSend}>
        {label.data ?? deep.data}
      </button>
    </section>
  );
}

const sendOptions = api.chat.send.mutationOptions({ retry: false });
expectType<readonly [name: string]>(sendOptions.mutationKey);
expectType<(input: { roomId: string; text: string }) => Promise<SendResult>>(
  sendOptions.mutationFn,
);
const lengthOptions = api.chat.length.queryOptions("abc");
expectType<() => Promise<number>>(lengthOptions.queryFn);

export function App(): ReactElement {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        <Messages roomId="r1" />
      </Suspense>
    </QueryClientProvider>
  );
}

export function ReactMisuse(): null {
  const send = api.chat.send.useMutation();
  // @ts-expect-error roomId must be a string
  send.mutate({ roomId: 1, text: "x" });
  // @ts-expect-error useQuery needs the input when the schema requires one
  api.chat.length.useQuery();
  // @ts-expect-error options come after the input
  api.chat.length.useQuery({ staleTime: 1 });
  // @ts-expect-error publications have no useQuery
  api.chat.messages.useQuery();
  // @ts-expect-error methods have no usePublication
  api.ping.usePublication();
  return null;
}
