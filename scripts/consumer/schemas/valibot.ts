import * as v from "valibot";

export const noInput = v.void();
export const roomId = v.string();
export const sendInput = v.object({ roomId: v.string(), text: v.string() });
export const roomFilter = v.object({ roomId: v.string() });
export const lengthOf = v.pipe(
  v.string(),
  v.transform((value) => value.length),
);
export const optionalPage = v.optional(v.object({ page: v.number() }));
