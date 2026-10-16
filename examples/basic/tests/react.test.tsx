// Browser tests of the React hooks. A headless browser runs them inside the real Meteor client
// (`npm run test:meteor -- --client`), so they go through real DDP, the merge box, minimongo and
// Tracker, unlike tests/unit/react.test.tsx, which runs against in-memory fakes.
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { cleanup, configure, fireEvent, render, waitFor, within } from "@testing-library/react";
// biome-ignore lint/style/useNodejsImportProtocol: the client bundle resolves "assert" through meteor-node-stubs
import { strict as assert } from "assert";
import { Meteor } from "meteor/meteor";
import { createClient, isMeteorError } from "meteor-rpc/react";
import React, { Component, type ReactNode, StrictMode, Suspense, useState } from "react";
import { api } from "/imports/api/client";
import type { BrowserServer } from "./browser-module";
import type { ProbeServer } from "./probe-module";

// findBy* and waitFor give up after 1 s by default; a busy CI machine needs longer.
configure({ asyncUtilTimeout: 5000 });

const { browser } = createClient<BrowserServer>();
const { probe } = createClient<ProbeServer>();

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error === undefined) return this.props.children;
    return (
      <p>
        {`error: ${isMeteorError(error) ? error.error : String(error)}`}
        <button type="button" onClick={() => this.setState({ error: undefined })}>
          retry
        </button>
      </p>
    );
  }
}

/** Renders `ui` the way an app does, and returns queries scoped to it. */
function renderApp(ui: ReactNode, { strict = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const caught: unknown[] = [];
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Boundary>
        <Suspense fallback={<p>loading</p>}>{ui}</Suspense>
      </Boundary>
    </QueryClientProvider>
  );
  // React logs every error an error boundary catches; collect them instead.
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree, {
    onCaughtError: (error) => caught.push(error),
  });
  return Object.assign(within(view.container), { caught });
}

function MessageList({ label, roomId, limit }: { label: string; roomId: string; limit?: number }) {
  // A new input object every render, like most apps write it.
  const { data } = api.chat.messages.usePublication(limit ? { roomId, limit } : { roomId });
  return (
    <ul aria-label={label}>
      {data.map((message) => (
        <li key={message._id}>{message.text}</li>
      ))}
    </ul>
  );
}

// Assert on strings, never on DOM nodes: failing asserts util.inspect their operands, and
// inspecting a rendered node walks React's fiber tree, which can block the page for seconds.
const texts = (element: HTMLElement) =>
  Array.from(element.querySelectorAll("li"), (item) => item.textContent).sort();

/** Live subscriptions of this client to `name` (Meteor's private, long-stable bookkeeping). */
const subscriptionsTo = (name: string) => {
  const { connection } = Meteor as unknown as {
    connection: { _subscriptions: Record<string, { name: string }> };
  };
  return Object.values(connection._subscriptions).filter((sub) => sub.name === name).length;
};

describe("React hooks in a real browser", function () {
  this.timeout(10_000);

  beforeEach(async () => {
    await browser.reset();
    await browser.logout();
  });

  afterEach(cleanup);

  it("useSuspenseQuery suspends until the method returns; useQuery does not suspend", async () => {
    function Suspending() {
      const { data: pong } = api.ping.useSuspenseQuery();
      // The input crosses DDP and the schema: "four" arrives as 4.
      const { data: measured } = probe.measure.useSuspenseQuery("four");
      return <p>{`${pong} ${measured.value} ${measured.type}`}</p>;
    }
    const suspending = renderApp(<Suspending />);
    suspending.getByText("loading"); // throws unless the first render suspended
    await suspending.findByText("pong 4 number");

    function NotSuspending() {
      const query = api.ping.useQuery();
      return <p>{query.isPending ? "pending" : `got ${query.data}`}</p>;
    }
    const notSuspending = renderApp(<NotSuspending />);
    notSuspending.getByText("pending");
    await notSuspending.findByText("got pong");
  });

  it("useMutation calls void-input methods without an argument; queryKey() invalidates", async () => {
    function Session() {
      const queryClient = useQueryClient();
      const { data: me } = probe.whoami.useSuspenseQuery();
      // auth.guest takes z.void(): an argument (even null) would fail validation.
      const login = api.auth.guest.useMutation({
        onSuccess: () => queryClient.invalidateQueries({ queryKey: probe.whoami.queryKey() }),
      });
      return (
        <>
          <p>{`user ${me.ctxUserId ?? "none"}`}</p>
          <button type="button" onClick={() => login.mutate()}>
            log in
          </button>
          {login.error && <p>{`login failed: ${login.error.message}`}</p>}
          {login.data && <p>{`logged in as ${login.data}`}</p>}
        </>
      );
    }
    const screen = renderApp(<Session />);
    await screen.findByText("user none");
    fireEvent.click(screen.getByRole("button", { name: "log in" }));
    const loggedIn = await screen.findByText(/^logged in as /);
    const userId = loggedIn.textContent!.replace("logged in as ", "");
    assert.match(userId, /^\w{17}$/);
    // The refetch triggered by invalidateQueries runs on the now logged-in connection.
    await screen.findByText(`user ${userId}`);
  });

  it("usePublication renders a cursor publication and follows inserts and removals", async () => {
    await api.auth.guest();
    const roomId = await api.chat.createRoom({ name: "Lobby" });
    const firstId = await browser.addMessage({ roomId, text: "first" });
    const screen = renderApp(<MessageList label="lobby" roomId={roomId} />);
    const list = await screen.findByRole("list", { name: "lobby" });
    assert.deepEqual(texts(list), ["first"]);

    await api.chat.send({ roomId, text: "  second  " }); // valibot trims it on the server
    await waitFor(() => assert.deepEqual(texts(list), ["first", "second"]));

    await api.chat.moderation.deleteMessage({ messageId: firstId });
    await waitFor(() => assert.deepEqual(texts(list), ["second"]));
  });

  it("keeps the documents of different inputs apart, even when they overlap", async () => {
    await api.auth.guest();
    const a = await api.chat.createRoom({ name: "A" });
    const b = await api.chat.createRoom({ name: "B" });
    await browser.addMessage({ roomId: a, text: "a1", createdAt: new Date(1000) });
    await browser.addMessage({ roomId: b, text: "b1", createdAt: new Date(1000) });
    const screen = renderApp(
      <>
        <MessageList label="a" roomId={a} />
        <MessageList label="a, latest" roomId={a} limit={1} />
        <MessageList label="b" roomId={b} />
      </>,
    );
    const listA = await screen.findByRole("list", { name: "a" });
    const latestA = screen.getByRole("list", { name: "a, latest" });
    const listB = screen.getByRole("list", { name: "b" });
    assert.deepEqual(texts(listA), ["a1"]);
    assert.deepEqual(texts(latestA), ["a1"]);
    assert.deepEqual(texts(listB), ["b1"]);

    // a2 is newer: it pushes a1 out of the limited instance only.
    await browser.addMessage({ roomId: a, text: "a2", createdAt: new Date(2000) });
    await waitFor(() => assert.deepEqual(texts(latestA), ["a2"]));
    await waitFor(() => assert.deepEqual(texts(listA), ["a1", "a2"]));
    assert.deepEqual(texts(listB), ["b1"]);
  });

  it("subscribes once in StrictMode, re-renders with a new input object, and stops on unmount", async () => {
    function Counted() {
      const [renders, setRenders] = useState(0);
      browser.counted.usePublication({ id: "strict", page: 1 }); // new object every render
      return (
        <button type="button" onClick={() => setRenders((count) => count + 1)}>
          {`rendered ${renders}`}
        </button>
      );
    }
    const screen = renderApp(<Counted />, { strict: true });
    for (let clicks = 0; clicks < 5; clicks++) {
      fireEvent.click(await screen.findByRole("button", { name: `rendered ${clicks}` }));
    }
    await screen.findByRole("button", { name: "rendered 5" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(subscriptionsTo("browser.counted"), 1);
    assert.equal(await browser.runs("strict"), 1);

    cleanup();
    await waitFor(() => assert.equal(subscriptionsTo("browser.counted"), 0));
  });

  it("returns one live array per key of a shared publication", async () => {
    await api.auth.guest();
    const roomId = await api.chat.createRoom({ name: "General" });
    let names: string[] = [];
    function Room() {
      const { data, collections } = api.chat.room.usePublication(roomId);
      names = Object.values(collections).map(
        (collection) => (collection as unknown as { _name: string })._name,
      );
      return (
        <p>{`${data.room.map((room) => room.name).join()}: ${data.members.length} members`}</p>
      );
    }
    const screen = renderApp(<Room />);
    await screen.findByText("General: 0 members");
    // One client collection per key: meteor-rpc:pub:<path>#<input hash>/<key>.
    assert.equal(names.length, 2);
    assert.match(
      names.find((name) => name.endsWith("/room"))!,
      /^meteor-rpc:pub:chat\.room#\w+\/room$/,
    );
    assert.match(
      names.find((name) => name.endsWith("/members"))!,
      /^meteor-rpc:pub:chat\.room#\w+\/members$/,
    );

    await api.chat.join(roomId);
    await screen.findByText("General: 1 members");
  });

  it("throws a failed subscription to the error boundary and subscribes again after a reset", async () => {
    // chat.messages runs the chat module's requireUser middleware, and nobody is logged in.
    const screen = renderApp(<MessageList label="room" roomId="r1" />);
    await screen.findByText("error: not-authorized");
    assert.equal(screen.caught.length, 1);
    assert.ok(isMeteorError(screen.caught[0]));

    await api.auth.guest();
    await browser.addMessage({ roomId: "r1", text: "welcome back" });
    fireEvent.click(screen.getByRole("button", { name: "retry" }));
    await screen.findByText("welcome back");
    assert.equal(subscriptionsTo("chat.messages"), 1);
  });
});
