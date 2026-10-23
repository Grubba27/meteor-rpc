import { beforeEach } from "vitest";
import { installPackages, resetFakes } from "./runtime";

// meteor-rpc reads Meteor from the `Package` global (see src/meteor/package.ts).
installPackages();

beforeEach(() => {
  resetFakes();
});
