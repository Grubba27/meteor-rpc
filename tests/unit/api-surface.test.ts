// Runtime exports of every entry point. Removing or renaming one is a breaking change:
// only additions are allowed within 2.x. Update the snapshot only when adding exports.
import { describe, expect, it } from "vitest";
import * as client from "../../src/client/index";
import * as root from "../../src/index";
import * as react from "../../src/react/index";
import * as server from "../../src/server/index";

const surface = (module: object) => Object.keys(module).sort();

describe("public API surface", () => {
  it("meteor-rpc", () => {
    expect(surface(root)).toMatchInlineSnapshot(`
      [
        "VALIDATION_ERROR",
        "createCaller",
        "createClient",
        "createModule",
        "isMeteorError",
        "isValidationError",
      ]
    `);
  });

  it("meteor-rpc/server", () => {
    expect(surface(server)).toMatchInlineSnapshot(`
      [
        "VALIDATION_ERROR",
        "createCaller",
        "createModule",
        "isMeteorError",
        "isValidationError",
      ]
    `);
  });

  it("meteor-rpc/client", () => {
    expect(surface(client)).toMatchInlineSnapshot(`
      [
        "VALIDATION_ERROR",
        "createClient",
        "isMeteorError",
        "isValidationError",
      ]
    `);
  });

  it("meteor-rpc/react", () => {
    expect(surface(react)).toMatchInlineSnapshot(`
      [
        "VALIDATION_ERROR",
        "createClient",
        "isMeteorError",
        "isValidationError",
      ]
    `);
  });

  it("the root createClient is the React one", () => {
    expect(root.createClient).toBe(react.createClient);
  });
});
