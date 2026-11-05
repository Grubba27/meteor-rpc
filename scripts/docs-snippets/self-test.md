# docs-snippets self-test

`npm run test:docs` checks this page together with the documentation. Each block must fail with
exactly the errors its marker lists, so the run fails when the checker stops reporting them.

A block that doesn't parse, such as a signature summary, must not hide the type errors of the
other blocks.

<!-- docs-snippets: expect-error TS1005 TS1109 -->
```ts
addMethod(name, schema, resolver: (input, context) => result, config?)
```

`build()` is only for the root module, so calling it on a submodule is a type error.

<!-- docs-snippets: expect-error TS2684 -->
```ts
createModule("chat").addMethod("ping", z.void(), () => 1).build();
```
