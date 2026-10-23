import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isValidationError } from "meteor-rpc/react";
import React, { Component, type FormEvent, type ReactNode, Suspense, useState } from "react";
import { api } from "/imports/api/client";

const queryClient = new QueryClient();

// Suspense hooks (useSuspenseQuery, usePublication) need a <Suspense> boundary,
// and failed calls or subscriptions throw to the nearest error boundary.
export const App = () => (
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <Suspense fallback={<p>Loading…</p>}>
        <Chat />
      </Suspense>
    </ErrorBoundary>
  </QueryClientProvider>
);

function Chat() {
  const { data: pong } = api.ping.useSuspenseQuery(); // suspends until the server answers
  const { data: rooms } = api.rooms.usePublication(); // live list of rooms, suspends until ready
  const login = api.auth.guest.useMutation(); // void input: login.mutate()
  const createRoom = api.chat.createRoom.useMutation();
  const join = api.chat.join.useMutation();
  const [roomId, setRoomId] = useState<string>();
  const [name, setName] = useState("");

  if (!login.data) {
    return (
      <main>
        <p>Server says {pong}.</p>
        <button type="button" disabled={login.isPending} onClick={() => login.mutate()}>
          Join as guest
        </button>
      </main>
    );
  }

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    createRoom.mutate({ name }, { onSuccess: () => setName("") });
  };

  return (
    <main>
      <form onSubmit={onCreate}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New room" />
        <button type="submit" disabled={createRoom.isPending}>
          Create
        </button>
        {createRoom.error && <ErrorText error={createRoom.error} />}
      </form>
      <ul>
        {rooms.map((room) => (
          <li key={room._id}>
            <button
              type="button"
              onClick={() => join.mutate(room._id, { onSuccess: () => setRoomId(room._id) })}
            >
              {room.name}
            </button>
          </li>
        ))}
      </ul>
      {roomId && (
        <Suspense fallback={<p>Opening room…</p>}>
          <Room roomId={roomId} />
        </Suspense>
      )}
    </main>
  );
}

function Room({ roomId }: { roomId: string }) {
  // Shared publication: one subscription, one array per key.
  const { data } = api.chat.room.usePublication(roomId);
  const { data: messages } = api.chat.messages.usePublication({ roomId });
  const send = api.chat.send.useMutation();
  const [text, setText] = useState("");

  const onSend = (event: FormEvent) => {
    event.preventDefault();
    send.mutate({ roomId, text }, { onSuccess: () => setText("") });
  };

  return (
    <section>
      <h2>
        {data.room[0]?.name} ({data.members.length} members)
      </h2>
      <ol>
        {[...messages]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((message) => (
            <li key={message._id}>{message.text}</li>
          ))}
      </ol>
      <form onSubmit={onSend}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" />
        <button type="submit">Send</button>
        {send.error && <ErrorText error={send.error} />}
      </form>
    </section>
  );
}

function ErrorText({ error }: { error: Error }) {
  // Validation errors carry one issue per invalid field in `details`.
  const text = isValidationError(error)
    ? error.details.map((issue) => issue.message).join(", ")
    : error.message;
  return <p role="alert">{text}</p>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <p role="alert">
        Something went wrong: {this.state.error.message}{" "}
        <button type="button" onClick={() => this.setState({ error: undefined })}>
          Retry
        </button>
      </p>
    );
  }
}
