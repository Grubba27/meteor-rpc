import type { MeteorErrorLike } from "../meteor/types.js";

/** `error` code of the `Meteor.Error` thrown when a method or publication input fails validation. */
export const VALIDATION_ERROR = "validation-error";

/** One validation problem, as sent to the client in `error.details`. */
export interface ValidationIssue {
  readonly message: string;
  /** Path to the invalid value, e.g. `["user", "email"]`. Empty for the root value. */
  readonly path: ReadonlyArray<string | number>;
}

/** A `Meteor.Error` thrown because the input failed validation. */
export interface ValidationError extends MeteorErrorLike {
  error: typeof VALIDATION_ERROR;
  details: ValidationIssue[];
}

/** True for any `Meteor.Error`, on the server or after it crossed DDP. */
export function isMeteorError(error: unknown): error is MeteorErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { errorType?: unknown }).errorType === "Meteor.Error"
  );
}

/** True when a method call or subscription failed because its input didn't match the schema. */
export function isValidationError(error: unknown): error is ValidationError {
  return isMeteorError(error) && error.error === VALIDATION_ERROR && Array.isArray(error.details);
}

/** Human-readable one-line summary of validation issues. */
export function formatIssues(issues: ReadonlyArray<ValidationIssue>): string {
  return issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    )
    .join("; ");
}
