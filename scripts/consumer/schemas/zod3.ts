// zod 3.24 is the first zod 3 release that implements Standard Schema.
import { z } from "zod";

export const noInput = z.void();
export const roomId = z.string();
export const sendInput = z.object({ roomId: z.string(), text: z.string() });
export const roomFilter = z.object({ roomId: z.string() });
export const lengthOf = z.string().transform((value) => value.length);
export const optionalPage = z.object({ page: z.number() }).optional();
