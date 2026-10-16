import { Meteor } from "../meteor/meteor.js";
import { formatIssues, VALIDATION_ERROR, type ValidationIssue } from "./errors.js";
import type { StandardSchemaV1 } from "./standard-schema.js";

/** Any Standard Schema: zod (>= 3.24), valibot (>= 1.0), arktype (>= 2.0), and others. */
export type AnySchema = StandardSchemaV1<any, any>;

/** The type a caller must send for `TSchema`. */
export type InferInput<TSchema extends AnySchema> = StandardSchemaV1.InferInput<TSchema>;

/** The type the resolver receives after `TSchema` validated (and possibly transformed) the input. */
export type InferOutput<TSchema extends AnySchema> = StandardSchemaV1.InferOutput<TSchema>;

export function isStandardSchema(value: unknown): value is AnySchema {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const props = (value as { "~standard"?: { validate?: unknown } })["~standard"];
  return typeof props === "object" && props !== null && typeof props.validate === "function";
}

export function assertStandardSchema(value: unknown, name: string): asserts value is AnySchema {
  if (!isStandardSchema(value)) {
    throw new TypeError(
      `meteor-rpc: the schema of "${name}" is not a Standard Schema (https://standardschema.dev). ` +
        "Use zod >= 3.24, valibot >= 1.0, arktype >= 2.0, or another Standard Schema library.",
    );
  }
}

function toIssue(issue: StandardSchemaV1.Issue): ValidationIssue {
  const path = (issue.path ?? []).map((segment) => {
    const key = typeof segment === "object" && segment !== null ? segment.key : segment;
    return typeof key === "number" ? key : String(key);
  });
  return { message: issue.message, path };
}

/** Builds the `Meteor.Error` thrown for invalid input. `details` holds the issues. */
export function createValidationError(issues: ReadonlyArray<ValidationIssue>): Error {
  return new Meteor.Error(VALIDATION_ERROR, `Validation failed: ${formatIssues(issues)}`, issues);
}

/** Validates `value` with any Standard Schema and returns the parsed output, or throws a validation `Meteor.Error`. */
export async function validate<TSchema extends AnySchema>(
  schema: TSchema,
  value: unknown,
): Promise<InferOutput<TSchema>> {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    throw createValidationError(result.issues.map(toIssue));
  }
  return result.value;
}
