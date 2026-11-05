// The providers meteor-rpc's React hooks need. Copy to imports/ui/App.tsx.
//   meteor npm install @tanstack/react-query react-error-boundary
import { QueryClient, QueryClientProvider, QueryErrorResetBoundary } from "@tanstack/react-query";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary"; // or the app's own error boundary
import { TaskList } from "./TaskList";

const queryClient = new QueryClient(); // one per app, outside components

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Lets "Retry" refetch failed suspense queries instead of throwing the cached error. */}
      <QueryErrorResetBoundary>
        {({ reset }) => (
          // useSuspenseQuery and usePublication throw failures to the nearest error boundary…
          <ErrorBoundary
            onReset={reset}
            fallbackRender={({ resetErrorBoundary }) => (
              <p role="alert">
                Something went wrong.{" "}
                <button type="button" onClick={resetErrorBoundary}>
                  Retry
                </button>
              </p>
            )}
          >
            {/* …and suspend until their data is ready. */}
            <Suspense fallback={<p>Loading…</p>}>
              <TaskList listId="inbox" />
            </Suspense>
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
    </QueryClientProvider>
  );
}
