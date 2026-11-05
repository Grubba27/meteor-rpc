// Names the documentation's fragments use without importing them. A fragment (a block without a
// "// path/to/file.ts" first line) gets an import of the ones it mentions and doesn't declare.
// scripts/docs-snippets.mjs reads the export list of this file.
import { QueryClient } from "@tanstack/react-query";
import { createClient } from "meteor-rpc/react";
import type { Middleware } from "meteor-rpc/server";
import { z } from "zod";
import type { Server } from "./server";

export { DDP } from "meteor/ddp";
export { Meteor } from "meteor/meteor";
export { Mongo } from "meteor/mongo";
export { Tracker } from "meteor/tracker";
export { createClient, isMeteorError, isValidationError } from "meteor-rpc/react";
export { createModule, type Middleware } from "meteor-rpc/server";
export * as v from "valibot";
export { z } from "zod";
export { AuditLog, Messages, Rooms, Tasks } from "./collections";
export { type Server, server } from "./server";

export const api = createClient<Server>();
export const queryClient = new QueryClient();

// Values the examples take from their surroundings.
export declare const id: string;
export declare const roomId: string;
export declare function render(...args: unknown[]): void;
export declare const requireAdmin: Middleware;

// `.addMethod("save", schema, save)` and friends.
export const schema = z.object({ id: z.string() });
export declare function save(input: z.output<typeof schema>): Promise<void>;
export declare const sendCode: typeof save;
export declare const charge: typeof save;

// Third-party APIs the examples call.
export declare const toast: { error(message: string): void };
export declare const form: { setError(name: string, error: { message: string }): void };
export declare const Sentry: { captureException(error: unknown, context?: object): void };
