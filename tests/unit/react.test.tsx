// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Component, type ReactNode, StrictMode, Suspense, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createClient } from "../../src/react/index";
import { createModule } from "../../src/server/index";
import { Collection, MeteorError, subscriptionLog } from "../fakes/runtime";

let counter = 0;
const unique = (name: string) => `${name}${++counter}`;

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: undefined as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error) return <p>error: {(this.state.error as { error?: string }).error}</p>;
    return this.props.children;
  }
}

function renderWithProviders(ui: ReactNode, { strict = false } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={queryClient}>
      <Boundary>
        <Suspense fallback={<p>loading</p>}>{ui}</Suspense>
      </Boundary>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("React client", () => {
  it("useSuspenseQuery suspends, then renders the result", async () => {
    const server = createModule()
      .addMethod("greet", z.object({ name: z.string() }), ({ name }) => `hello ${name}`)
      .build();
    const api = createClient<typeof server>();
    function Greeting() {
      const { data } = api.greet.useSuspenseQuery({ name: "ada" });
      return <p>{data}</p>;
    }
    renderWithProviders(<Greeting />);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("hello ada")).toBeTruthy();
  });

  it("useQuery does not suspend", async () => {
    const server = createModule()
      .addMethod("answer", z.void(), () => 42)
      .build();
    const api = createClient<typeof server>();
    function Answer() {
      const { data, isPending } = api.answer.useQuery();
      return <p>{isPending ? "pending" : `answer ${data}`}</p>;
    }
    renderWithProviders(<Answer />);
    expect(screen.getByText("pending")).toBeTruthy();
    expect(await screen.findByText("answer 42")).toBeTruthy();
  });

  it("useQuery suspends with { suspense: true }, and errors reach the error boundary", async () => {
    const server = createModule()
      .addMethod("double", z.number(), (n) => {
        if (n < 0) throw new MeteorError("negative");
        return n * 2;
      })
      .build();
    const api = createClient<typeof server>({ suspense: true });
    function Double({ n }: { n: number }) {
      const { data } = api.double.useQuery(n, { staleTime: 1000 });
      return <p>double {data.toFixed(0)}</p>;
    }
    renderWithProviders(<Double n={21} />);
    expect(screen.getByText("loading")).toBeTruthy();
    expect(await screen.findByText("double 42")).toBeTruthy();

    document.body.innerHTML = "";
    renderWithProviders(<Double n={-1} />);
    expect(await screen.findByText("error: negative")).toBeTruthy();
  });

  it("useMutation works for methods without input", async () => {
    let calls = 0;
    const server = createModule()
      .addMethod("bump", z.void(), () => ++calls)
      .build();
    const api = createClient<typeof server>();
    function Bump() {
      const mutation = api.bump.useMutation();
      return (
        <button type="button" onClick={() => mutation.mutate()}>
          {mutation.data ?? "none"}
        </button>
      );
    }
    renderWithProviders(<Bump />);
    act(() => screen.getByRole("button").click());
    expect(await screen.findByText("1")).toBeTruthy();
  });

  it("exposes query keys for invalidation", () => {
    const api = createClient<any>() as any;
    expect(api.todos.list.queryKey()).toEqual(["todos.list"]);
    expect(api.todos.list.queryKey({ page: 1 })).toEqual(["todos.list", { page: 1 }]);
    expect(api.todos.list.queryOptions({ page: 1 }, { staleTime: 5 })).toMatchObject({
      queryKey: ["todos.list", { page: 1 }],
      staleTime: 5,
    });
    expect(api.todos.add.mutationOptions().mutationKey).toEqual(["todos.add"]);
  });

  it("usePublication renders live documents", async () => {
    const Tasks = new Collection<{ _id: string; title: string; list: string }>(unique("tasks"));
    await Tasks.insertAsync({ _id: "t1", title: "write tests", list: "a" });
    const server = createModule()
      .addPublication("tasks", z.object({ list: z.string() }), ({ list }) => Tasks.find({ list }))
      .build();
    const api = createClient<typeof server>();
    function TaskList() {
      const { data } = api.tasks.usePublication({ list: "a" });
      return (
        <ul>
          {data.map((task) => (
            <li key={task._id}>{task.title}</li>
          ))}
        </ul>
      );
    }
    renderWithProviders(<TaskList />);
    expect(await screen.findByText("write tests")).toBeTruthy();
    await act(async () => {
      await Tasks.insertAsync({ _id: "t2", title: "ship v2", list: "a" });
    });
    expect(await screen.findByText("ship v2")).toBeTruthy();
  });

  it("does not loop with object input in StrictMode (issue #8)", async () => {
    const Items = new Collection(unique("items"));
    await Items.insertAsync({ _id: "i1", label: "one" });
    const name = unique("itemsPub");
    const server = createModule()
      .addPublication(name, z.object({ page: z.number() }), () => Items.find())
      .build();
    const api = createClient<typeof server>() as any;
    function Items_() {
      const [, setTick] = useState(0);
      // A new object every render: v1 re-subscribed forever here.
      const { data } = api[name].usePublication({ page: 1 });
      return (
        <button type="button" onClick={() => setTick((t) => t + 1)}>
          {data.length} items
        </button>
      );
    }
    renderWithProviders(<Items_ />, { strict: true });
    expect(await screen.findByText("1 items")).toBeTruthy();
    for (let i = 0; i < 5; i++) act(() => screen.getByRole("button").click());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(subscriptionLog.filter((entry) => entry.name === name)).toHaveLength(1);
  });

  it("shared publications return data per key", async () => {
    const Rooms = new Collection(unique("rooms"));
    const Members = new Collection(unique("members"));
    await Rooms.insertAsync({ _id: "r1", name: "General" });
    await Members.insertAsync({ _id: "m1", name: "Ada" });
    const server = createModule()
      .addSharedPublication("room", z.string(), () => ({
        room: Rooms.find(),
        members: Members.find(),
        empty: null,
      }))
      .build();
    const api = createClient<typeof server>();
    function Room() {
      const { data } = api.room.usePublication("r1");
      return (
        <p>
          {data.room.map((room) => String(room.name)).join()} / {data.members.length} /{" "}
          {data.empty.length}
        </p>
      );
    }
    renderWithProviders(<Room />);
    expect(await screen.findByText("General / 1 / 0")).toBeTruthy();
  });

  it("surfaces subscription errors to the error boundary", async () => {
    const server = createModule()
      .addPublication("forbidden", z.void(), () => {
        throw new MeteorError("not-authorized");
      })
      .build();
    const api = createClient<typeof server>();
    function Forbidden() {
      api.forbidden.usePublication();
      return <p>never</p>;
    }
    const spy = console.error;
    console.error = () => {};
    renderWithProviders(<Forbidden />);
    await waitFor(() => expect(screen.getByText("error: not-authorized")).toBeTruthy());
    console.error = spy;
  });
});
