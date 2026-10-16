# Errors and validation

## What the caller receives

Every failure is thrown to the caller:

- the promise of `api.x()` rejects;
- `useMutation` sets `error`;
- suspense hooks throw to the nearest error boundary;
- `subscribe` calls `onStop(error)`.

meteor-rpc never turns an error into a successful result.

What crosses the wire follows Meteor's rules:

| Thrown on the server | Received by the client |
| --- | --- |
| `new Meteor.Error("not-found", "No such room", { id })` | the same `error`, `reason` and `details` |
| invalid input | `Meteor.Error("validation-error", "Validation failed: …", issues)` |
| any other error (`TypeError`, a database error, …) | `Meteor.Error(500, "Internal server error")`; the details stay in the server log |

Throw `Meteor.Error` for anything the user should see.

## Validation errors

Input is validated on the server for every method call and subscription. On failure,
`error.details` is a list of issues:

```ts
interface ValidationIssue {
  message: string;                       // from your validator
  path: ReadonlyArray<string | number>; // e.g. ["address", "zip"]; empty for the whole input
}
```

```ts
import { isValidationError } from "meteor-rpc";

const signup = api.users.signup.useMutation({
  onError(error) {
    if (!isValidationError(error)) return toast.error(error.message);
    for (const issue of error.details) form.setError(issue.path.join("."), { message: issue.message });
  },
});
```

Also exported: `VALIDATION_ERROR` (the `"validation-error"` code) and `isMeteorError(error)`.

## Observing errors on the server

`onErrorResolve` hooks see every failure, including validation, middleware and resolver errors,
with the full context. The error is re-thrown afterwards. If `parsed` is `undefined`, validation
failed.

```ts
.addMethod("charge", schema, charge, {
  hooks: {
    onErrorResolve: [({ name, userId, error }) => Sentry.captureException(error, { extra: { name, userId } })],
  },
})
```
