// dist/esm holds the ES module build (served under the `import` condition of `exports`).
// This marks it as ESM for Node and TypeScript; dist/ itself stays CommonJS, because
// Meteor runs server-side node_modules code with plain Node `require`.
import { writeFileSync } from "node:fs";

writeFileSync(new URL("../dist/esm/package.json", import.meta.url), '{ "type": "module" }\n');
