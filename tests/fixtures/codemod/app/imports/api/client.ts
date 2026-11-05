// @ts-nocheck (codemod fixture: meteor-rpc 1.x code)
import { createClient } from "meteor-rpc";
import type { Server } from "./server";

export const api = createClient<Server>();

export const notAClient = { todos: { list: { useQuery: (filter: string) => filter } } };
