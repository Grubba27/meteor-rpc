// Client test entry. Runs in a headless browser with `npm run test:meteor -- --client`.
// It also proves that the client bundle resolves "meteor-rpc/react" (Meteor's classic bundler
// ignores package.json "exports" and uses the react/ stub folder).
// biome-ignore lint/style/useNodejsImportProtocol: the client bundle resolves "assert" through meteor-node-stubs
import { strict as assert } from "assert";
import { api } from "/imports/api/client";
import "./react.test";

describe("client bundle", () => {
  it("builds the React client from meteor-rpc/react", () => {
    assert.equal(typeof api.ping.useSuspenseQuery, "function");
    assert.deepEqual(api.chat.send.queryKey({ roomId: "r", text: "t" }), [
      "chat.send",
      { roomId: "r", text: "t" },
    ]);
  });
});
