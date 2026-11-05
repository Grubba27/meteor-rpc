// Stands in for "@acme/billing-api", the other app in docs/client.md (mapped in tsconfig paths).
import { createModule } from "meteor-rpc/server";
import { z } from "zod";
import { Invoices } from "./collections";

const invoices = createModule("invoices")
  .addMethod("list", z.void(), () => Invoices.find().fetchAsync())
  .addPublication("updates", z.void(), () => Invoices.find())
  .buildSubmodule();

export const server = createModule().addSubmodule(invoices).build();
export type Server = typeof server;
