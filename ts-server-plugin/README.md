# meteor-rpc TypeScript Server Plugin

Enables **Go to Definition** (`Ctrl+B` / `F12`) on Meteor RPC method and publication names in any editor that uses the TypeScript language server (VS Code, Cursor, Neovim + tsserver, WebStorm, etc.).

When you place your cursor on a method name in a client call such as `app.foo.baz(123)` and trigger Go to Definition, the plugin redirects you to the matching `createMethod("foo.baz", ...)` or `addMethod("baz", ...)` call site rather than to the library types.

## How it works

The plugin wraps the TypeScript language service's `getDefinitionAndBoundSpan` handler. When triggered on an identifier, it:

1. Resolves the identifier's type via the TypeScript type checker.
2. Checks whether the type has a `config.name` property holding a string literal — the shape shared by `ReturnMethod<Name, ...>` and `ReturnSubscription<Name, ...>`.
3. If found, searches all project source files for a `createMethod`, `createMutation`, `createQuery`, `createPublication`, `createRealtimeQuery`, `createSharedRealtimeQuery`, `addMethod`, `addPublication`, or `addSharedPublication` call whose first string argument matches that name.
4. Returns the matching call site as the definition location.

If no match is found it falls back to the default TypeScript behavior silently.

## Setup

### 1. Build the plugin (first time only)

```sh
cd ts-server-plugin
npm install
npm run build
```

This produces `ts-server-plugin/dist/index.js`, which is what tsserver loads.

### 2. Add the plugin to your project's `tsconfig.json`

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "meteor-rpc/ts-server-plugin" }]
  }
}
```

The plugin name resolves to the package's `ts-server-plugin/` folder via Node module resolution, so as long as `meteor-rpc` is installed in the project there is nothing else to install.

### 3. VS Code: switch to workspace TypeScript

VS Code uses its own bundled TypeScript by default and does **not** load `tsconfig.json` plugins until you switch to the workspace version.

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **"TypeScript: Select TypeScript Version"**.
3. Choose **"Use Workspace Version"**.

This is a one-time, per-project setting stored in `.vscode/settings.json`:

```json
{
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

Other editors (Cursor, Neovim + nvim-lspconfig/tsserver, WebStorm) pick up `tsconfig.json` plugins automatically without any extra step.

## Usage

Works with both the `createModule` builder API and direct `createMethod` calls:

```typescript
// server/api.ts
const server = createModule()
  .addMethod("bar", z.string(), (arg) => "bar" as const)
  .addSubmodule(
    createModule("foo")
      .addMethod("baz", z.number(), (arg) => "baz" as const)
      .buildSubmodule()
  )
  .build();

export type Server = typeof server;

// client.ts
const app = createClient<Server>();

app.bar("str");      // Ctrl+B on `bar`  → goes to .addMethod("bar",  ...)
app.foo.baz(123);   // Ctrl+B on `baz`  → goes to .addMethod("baz",  ...)
```

## Testing locally

The quickest way to verify the plugin is working:

1. Build the plugin (`npm run build` inside `ts-server-plugin/`).
2. In the project that uses `meteor-rpc`, ensure the `plugins` entry is in `tsconfig.json` and VS Code is using workspace TypeScript (see Setup).
3. Reload the TS server: open the command palette and run **"TypeScript: Restart TS Server"**.
4. Open a client file, place the cursor on a method name (e.g. `bar` in `app.bar(...)`), and press `F12` / `Ctrl+B`. You should land at the `addMethod("bar", ...)` call site on the server.

### Confirming the plugin is loaded

Open the command palette and run **"TypeScript: Open TS Server Log"**. Search the log for `meteor-rpc` — you should see a line like:

```
Loading plugin meteor-rpc/ts-server-plugin from ...
```

If the line is absent, tsserver has not found the plugin. Double-check that:
- `npm run build` has been run and `dist/index.js` exists.
- The `plugins` entry in `tsconfig.json` is under `compilerOptions`.
- VS Code is set to use workspace TypeScript.

## Debugging

### Enable verbose tsserver logging

Set the `TSS_LOG` environment variable before starting your editor:

```sh
# macOS / Linux
TSS_LOG="-logToFile true -file /tmp/tsserver.log -level verbose" code .
```

Then tail the log while reproducing the issue:

```sh
tail -f /tmp/tsserver.log | grep -i "meteor-rpc\|getDefinition"
```

### Add temporary log lines to the plugin source

The plugin has access to the tsserver logger via `info.project.projectService.logger`:

```typescript
info.project.projectService.logger.info(`[meteor-rpc] resolved name: ${methodName}`);
```

Rebuild (`npm run build`) and restart the TS server (`"TypeScript: Restart TS Server"`) to pick up changes.

### Inspecting the resolved type

If Go to Definition is not redirecting where expected, the most common cause is that the type checker is not resolving the type to a `ReturnMethod` / `ReturnSubscription`. Add a log line in `extractMethodName` to print the type string:

```typescript
info.project.projectService.logger.info(
  `[meteor-rpc] type: ${checker.typeToString(type)}`
);
```

This will show what type the cursor position resolves to, which makes it easy to see whether the `config.name` path is being traversed correctly.
