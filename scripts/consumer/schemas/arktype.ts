import { type } from "arktype";

export const noInput = type("undefined");
export const roomId = type("string");
export const sendInput = type({ roomId: "string", text: "string" });
export const roomFilter = type({ roomId: "string" });
export const lengthOf = type("string").pipe((value) => value.length);
export const optionalPage = type({ page: "number" }).or("undefined");
