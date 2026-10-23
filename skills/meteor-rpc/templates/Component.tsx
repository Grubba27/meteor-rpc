// A component using methods and publications. Copy to imports/ui/TaskList.tsx and render it
// inside the providers of App.tsx (QueryClientProvider, an error boundary and <Suspense>).
import { useQueryClient } from "@tanstack/react-query";
import { isValidationError } from "meteor-rpc/react";
import { type FormEvent, useState } from "react";
import { api } from "/imports/api/client";

export function TaskList({ listId }: { listId: string }) {
  // Publication: live documents for THIS input. Suspends until ready, then re-renders on change.
  const { data: tasks } = api.tasks.byList.usePublication({ listId });
  // Shared publication: one array per key.
  const { data: overview } = api.tasks.overview.usePublication();
  // Method as a query: suspends until the result arrives, so `stats` is never undefined.
  const { data: stats } = api.tasks.stats.useSuspenseQuery({ listId });

  // Method results are cached: refetch the ones a mutation changes. Publications update by
  // themselves and never need invalidating.
  const queryClient = useQueryClient();
  const refreshStats = () =>
    queryClient.invalidateQueries({ queryKey: api.tasks.stats.queryKey({ listId }) });
  const add = api.tasks.add.useMutation({ onSuccess: refreshStats });
  const setDone = api.tasks.setDone.useMutation({ onSuccess: refreshStats });

  const [title, setTitle] = useState("");
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ listId, title }, { onSuccess: () => setTitle("") });
  };
  // Invalid input fails on the server with one issue per invalid field.
  const titleError = isValidationError(add.error)
    ? add.error.details.find((issue) => issue.path[0] === "title")?.message
    : add.error?.message;

  return (
    <section>
      <h2>
        {stats.open} open, {stats.done} done ({overview.lists.length} lists)
      </h2>
      <form onSubmit={onSubmit}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
        <button type="submit" disabled={add.isPending}>
          Add
        </button>
        {titleError && <p role="alert">{titleError}</p>}
      </form>
      <ul>
        {tasks.map((task) => (
          <li key={task._id}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                disabled={setDone.isPending}
                onChange={(event) => setDone.mutate({ id: task._id, done: event.target.checked })}
              />
              {task.title}
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
