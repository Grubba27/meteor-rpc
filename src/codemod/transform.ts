// The meteor-rpc 1.x → 2.0 transform of one file. Pure: source text in, new text out, plus what
// changed and what a human has to finish (with the MIGRATION.md section to read). Files are parsed
// with the TypeScript compiler API and edited with minimal text replacements, so formatting and
// comments outside the edited spans are kept.
//
// Automatic:
// - `api.x.useQuery(input, { useQueryOptions: o })` → `api.x.useSuspenseQuery(input, o)` (§8),
//   only for chains rooted at a meteor-rpc client (see project.ts).
// - `(raw, parsed) => …` middlewares and hooks → `({ raw, parsed }) => …` (§5).
// - `"meteor/grubba:rpc"` imports → `"meteor-rpc"` (§2).
// Reported: removed exports and method helpers (§11), `build()` on namespaced modules (§12),
// shared publications returning arrays (§10), error hooks and `__isError__` checks (§7).
import type * as TS from "typescript";
import {
  ATMOSPHERE_SPECIFIER,
  findProperty,
  firstSyntaxError,
  indexDeclarations,
  parseFile,
  positionOf,
  propertyNameText,
  propertyValue,
  REACT_CLIENT_SPECIFIERS,
  refersToRpcExport,
  scanRpcImports,
  shorten,
  type TypeScript,
  unwrap,
} from "./ast.js";
import {
  type ClientBindings,
  clientBindings,
  collectModuleFacts,
  type Project,
} from "./project.js";

/** Something the codemod changed or that needs a human, at a 1-based line and column. */
export interface Finding {
  readonly line: number;
  readonly column: number;
  /** One line. */
  readonly message: string;
  /** Section of the migration guide, e.g. "MIGRATION.md#7-errors-are-thrown". */
  readonly anchor: string;
}

/** Something the codemod can't migrate safely. */
export type ManualItem = Finding;

/** Replace `text` between `start` and `end` (offsets in the original source). */
export interface TextEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface TransformOptions {
  /**
   * The app creates its React client with `{ suspense: true }`, so `useQuery` keeps suspending:
   * keep the `useQuery` calls (only unwrap `{ useQueryOptions }`) and add the option to
   * `createClient()` calls.
   */
  readonly suspenseClient?: boolean;
  /**
   * Every file of this run. With `suspenseClient`, a `useQuery` call whose client is created in a
   * file outside the run is reported: that `createClient()` needs `{ suspense: true }` too.
   */
  readonly runFiles?: ReadonlySet<string>;
}

export interface TransformResult {
  /** The migrated source. Equal to the input when nothing changed. */
  readonly output: string;
  readonly changes: readonly Finding[];
  readonly manual: readonly ManualItem[];
  /** The edits that turn the input into `output`, sorted and non-overlapping. */
  readonly edits: readonly TextEdit[];
}

export type AnchorName =
  | "automated"
  | "install"
  | "hooks"
  | "errors"
  | "react"
  | "shared"
  | "removed"
  | "build";

/** Sections of MIGRATION.md the findings point to. */
export const ANCHORS: Readonly<Record<AnchorName, string>> = {
  automated: "MIGRATION.md#automated-migration",
  install: "MIGRATION.md#2-install",
  hooks: "MIGRATION.md#5-hooks-and-middlewares-take-one-context-object",
  errors: "MIGRATION.md#7-errors-are-thrown",
  react: "MIGRATION.md#8-react-usequery-vs-usesuspensequery",
  shared: "MIGRATION.md#10-shared-publications-return-named-cursors",
  removed: "MIGRATION.md#11-removed-exports",
  build: "MIGRATION.md#12-build-and-buildsubmodule",
};

// Files without any of these can't need a change; they aren't parsed.
const QUICK_CHECK = /meteor-rpc|grubba:rpc|useQuery|__isError__/;

type HookKind = "middleware" | "onBeforeResolve" | "onAfterResolve" | "onErrorResolve";

const HOOK_NAMES = ["onBeforeResolve", "onAfterResolve", "onErrorResolve"] as const;

/** 1.x positional parameters, in order, as fields of the 2.0 context object. */
const HOOK_KEYS: Readonly<Record<HookKind, readonly string[]>> = {
  middleware: ["raw", "parsed"],
  onBeforeResolve: ["raw", "parsed"],
  onAfterResolve: ["raw", "parsed", "result"],
  onErrorResolve: ["error", "raw", "parsed"],
};

const HOOK_LABELS: Readonly<Record<HookKind, string>> = {
  middleware: "middleware",
  onBeforeResolve: "onBeforeResolve hook",
  onAfterResolve: "onAfterResolve hook",
  onErrorResolve: "onErrorResolve hook",
};

const exampleFor = (kind: HookKind) => `({ ${HOOK_KEYS[kind].join(", ")} }) => …`;

/** Fields of the 2.0 context. A single destructured parameter using only these is already 2.0. */
const CONTEXT_FIELDS = new Set([
  "raw",
  "parsed",
  "result",
  "error",
  "type",
  "name",
  "userId",
  "connection",
  "invocation",
  "subscription",
]);

const REMOVED_EXPORTS: ReadonlyMap<string, string> = new Map([
  [
    "createMethod",
    "createMethod was removed: use createModule().addMethod(name, schema, resolver)",
  ],
  ["createQuery", "createQuery was removed: use createModule().addMethod(name, schema, resolver)"],
  [
    "createMutation",
    "createMutation was removed: use createModule().addMethod(name, schema, resolver)",
  ],
  [
    "createPublication",
    "createPublication was removed: use createModule().addPublication(name, schema, resolver)",
  ],
  [
    "createRealtimeQuery",
    "createRealtimeQuery was removed: use addPublication() on the server, and api.x.usePublication() or api.x.subscribe() / api.x.collection() on the client",
  ],
  [
    "createSharedRealtimeQuery",
    "createSharedRealtimeQuery was removed: use addSharedPublication(), whose resolver returns { key: cursor }",
  ],
  [
    "createSafeCaller",
    "createSafeCaller was removed: create a client with createClient<Server>() and call api.name(args); in server code inside a module, use createCaller(module).name(args) from meteor-rpc/server",
  ],
  ["ReturnMethod", "the ReturnMethod type was removed: use MethodDefinition"],
  ["ReturnSubscription", "the ReturnSubscription type was removed: use PublicationDefinition"],
  ["Config", "the Config type was removed: use MethodConfig or PublicationConfig"],
  ["SubscriptionCallbacks", "the SubscriptionCallbacks type was removed: use SubscribeCallbacks"],
]);

interface Advice {
  readonly message: string;
  readonly anchor: string;
}

const hookHelper = (name: string): [string, Advice] => [
  name,
  {
    message: `${name}() was removed: pass the hook in the method's config.hooks, or use the module's addMiddlewares()`,
    anchor: ANCHORS.hooks,
  },
];

const typeHelper = (name: string): [string, Advice] => [
  name,
  {
    message: `${name}() was removed: the result type is inferred from the resolver; annotate the resolver's return type to pin it`,
    anchor: ANCHORS.removed,
  },
];

/** Methods of 1.x method objects (`createMethod(...)` or `server.x`). */
const LEGACY_METHOD_HELPERS: ReadonlyMap<string, Advice> = new Map([
  hookHelper("addBeforeResolveHook"),
  hookHelper("addAfterResolveHook"),
  hookHelper("addErrorResolveHook"),
  [
    "setResolver",
    {
      message:
        "setResolver() was removed: pass the resolver to addMethod() (the client imports the server type with `import type`, so server code stays out of the bundle)",
      anchor: ANCHORS.removed,
    },
  ],
  typeHelper("expect"),
  typeHelper("returns"),
]);

const ERROR_HOOK_MESSAGE =
  "errors are re-thrown after onErrorResolve hooks run (1.x swallowed them and resolved with undefined): if callers relied on that, catch the error where the method is called";

const IS_ERROR_MESSAGE =
  "1.x error envelopes ({ __isError__ }) are gone: failed methods throw, so use try/catch (isMeteorError() / isValidationError() from meteor-rpc)";

/** Applies non-overlapping edits. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  let output = "";
  let cursor = 0;
  for (const edit of sorted) {
    output += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return output + text.slice(cursor);
}

export function transform(
  fileName: string,
  sourceText: string,
  ts: TypeScript,
  project: Project,
  options: TransformOptions = {},
): TransformResult {
  const suspenseClient = options.suspenseClient === true;
  if (!QUICK_CHECK.test(sourceText)) {
    return { output: sourceText, changes: [], manual: [], edits: [] };
  }
  const sf = parseFile(fileName, sourceText, ts);
  const syntaxError = firstSyntaxError(sf);
  if (syntaxError) {
    const { line, character } = sf.getLineAndCharacterOfPosition(syntaxError.start);
    const reason = ts.flattenDiagnosticMessageText(syntaxError.messageText, " ");
    return {
      output: sourceText,
      changes: [],
      manual: [
        {
          line: line + 1,
          column: character + 1,
          message: `could not parse this file (${reason}), so it wasn't migrated: check it by hand`,
          anchor: ANCHORS.automated,
        },
      ],
      edits: [],
    };
  }

  const edits: TextEdit[] = [];
  const changes: Finding[] = [];
  const manual: ManualItem[] = [];
  const reported = new Set<string>();

  const finding = (node: TS.Node, message: string, anchor: string): Finding => ({
    ...positionOf(sf, node),
    message,
    anchor,
  });
  const addManual = (node: TS.Node, message: string, anchor: string) => {
    const item = finding(node, message, anchor);
    const key = `${item.line}:${item.column}:${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    manual.push(item);
  };
  const addChange = (node: TS.Node, message: string, anchor: string) => {
    changes.push(finding(node, message, anchor));
  };
  const replace = (start: number, end: number, text: string) => {
    edits.push({ start, end, text });
  };
  const text = (node: TS.Node) => node.getText(sf);

  const imports = scanRpcImports(sf, ts);
  const usesRpc = imports.specifiers.length > 0;
  const buildsModules =
    imports.namespaces.size > 0 ||
    [...imports.named.values()].some((binding) => binding.imported === "createModule");
  const declarations = indexDeclarations(sf, ts);
  const clients: ClientBindings = sourceText.includes("useQuery")
    ? clientBindings(project, fileName, collectModuleFacts(sf, ts, imports))
    : { locals: new Set(), namespaces: new Map(), origins: new Map() };
  const migratedFunctions = new Set<TS.Node>();

  // --- imports ---------------------------------------------------------------------------

  for (const literal of imports.specifiers) {
    if (literal.text !== ATMOSPHERE_SPECIFIER) continue;
    replace(literal.getStart(sf) + 1, literal.getEnd() - 1, "meteor-rpc");
    addChange(
      literal,
      `"${ATMOSPHERE_SPECIFIER}" → "meteor-rpc" (2.0 is npm only: run \`meteor remove grubba:rpc\`)`,
      ANCHORS.install,
    );
  }
  for (const binding of imports.bindings) {
    const message = REMOVED_EXPORTS.get(binding.imported);
    if (message) addManual(binding.node, message, ANCHORS.removed);
  }

  // --- helpers -----------------------------------------------------------------------------

  /** Follows `const` references in this file to a literal of the wanted kind. */
  const resolveLiteral = <T extends TS.Expression>(
    expr: TS.Expression,
    is: (node: TS.Node) => node is T,
  ): { node: T; followed: boolean } | undefined => {
    let current = unwrap(expr, ts);
    let followed = false;
    for (let depth = 0; depth < 10; depth++) {
      if (is(current)) return { node: current, followed };
      if (!ts.isIdentifier(current)) return undefined;
      const initializer = declarations.constInitializer(current.text);
      if (!initializer) return undefined;
      current = unwrap(initializer, ts);
      followed = true;
    }
    return undefined;
  };

  const isUndefined = (expr: TS.Expression) =>
    (ts.isIdentifier(expr) && expr.text === "undefined") || ts.isVoidExpression(expr);

  /** Whether `expr` is `api.a.b` (at least one property) with `api` a meteor-rpc client. */
  /** The identifier a client chain starts from (`api` in `api.x.y`), if it's a client. */
  const clientRoot = (expr: TS.Expression): string | undefined => {
    const segments: string[] = [];
    let current = expr;
    for (;;) {
      if (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
        current = current.expression;
      } else if (ts.isElementAccessExpression(current)) {
        const key = current.argumentExpression;
        segments.unshift(ts.isStringLiteralLike(key) ? key.text : "");
        current = current.expression;
      } else if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
        current = current.expression;
      } else {
        break;
      }
    }
    if (!ts.isIdentifier(current)) return undefined;
    if (clients.locals.has(current.text)) return segments.length >= 1 ? current.text : undefined;
    const exported = clients.namespaces.get(current.text);
    return exported !== undefined && segments.length >= 2 && exported.has(segments[0] ?? "")
      ? current.text
      : undefined;
  };
  const isClientChain = (expr: TS.Expression): boolean => clientRoot(expr) !== undefined;

  // --- §8: useQuery → useSuspenseQuery ---------------------------------------------------

  /** Re-indents a multi-line expression moved out of `{ useQueryOptions: … }`. */
  const dedented = (node: TS.Node, outer: TS.Node): string => {
    const indentOf = (target: TS.Node) => {
      const { line } = sf.getLineAndCharacterOfPosition(target.getStart(sf));
      const lineText = sourceText.slice(
        sf.getPositionOfLineAndCharacter(line, 0),
        target.getStart(sf),
      );
      return /^[ \t]*/.exec(lineText)?.[0].length ?? 0;
    };
    const extra = indentOf(node) - indentOf(outer);
    const lines = text(node).split("\n");
    if (extra <= 0 || lines.length === 1) return lines.join("\n");
    const leading = new RegExp(`^[ \\t]{0,${extra}}`);
    return [lines[0], ...lines.slice(1).map((line) => line.replace(leading, ""))].join("\n");
  };

  /** --suspense-client: the client's createClient() must get the option too, so it must be in the run. */
  const checkSuspenseClientInRun = (callee: TS.PropertyAccessExpression) => {
    const root = clientRoot(callee.expression);
    const origin = root === undefined ? undefined : clients.origins.get(root);
    if (!origin || !options.runFiles || options.runFiles.has(origin)) return;
    addManual(
      callee.name,
      `useQuery() keeps suspending only if the client is created with { suspense: true }: ${origin} isn't part of this run, so add the option to its createClient() call (or run the codemod on it too)`,
      ANCHORS.react,
    );
  };

  const migrateUseQuery = (call: TS.CallExpression, callee: TS.PropertyAccessExpression) => {
    const label = `${shorten(text(callee.expression), 50)}.useQuery()`;
    const keepManual = (detail: string) =>
      addManual(
        callee.name,
        suspenseClient
          ? `${label} ${detail}: with { suspense: true } it keeps suspending; pass TanStack Query options directly as the 2nd argument`
          : `${label} ${detail}: in 2.0 rename it to useSuspenseQuery() (suspends, like 1.x) and pass TanStack Query options directly as the 2nd argument, or use the new non-suspending useQuery()`,
        ANCHORS.react,
      );
    const args = call.arguments;
    let options: string | undefined;
    if (args.length > 2) return keepManual("has more than two arguments");
    const second = args[1];
    if (second) {
      if (ts.isObjectLiteralExpression(second)) {
        const [only, ...others] = second.properties;
        if (only && others.length === 0) {
          if (
            ts.isPropertyAssignment(only) &&
            propertyNameText(only.name, ts) === "useQueryOptions"
          ) {
            options = dedented(only.initializer, second);
          } else if (
            ts.isShorthandPropertyAssignment(only) &&
            only.name.text === "useQueryOptions"
          ) {
            options = "useQueryOptions";
          } else {
            return keepManual("has options other than useQueryOptions");
          }
        } else if (only) {
          return keepManual("has options other than useQueryOptions");
        }
      } else if (!isUndefined(second)) {
        return keepManual("gets its options from an expression the codemod can't follow");
      }
    }
    if (suspenseClient) {
      checkSuspenseClientInRun(callee);
      if (!second || options === undefined) return;
      replace(second.getStart(sf), second.getEnd(), options);
      addChange(
        callee.name,
        `${label}: options passed directly instead of { useQueryOptions } (it keeps suspending with { suspense: true })`,
        ANCHORS.react,
      );
      return;
    }
    replace(callee.name.getStart(sf), callee.name.getEnd(), "useSuspenseQuery");
    if (second && options !== undefined) replace(second.getStart(sf), second.getEnd(), options);
    addChange(
      callee.name,
      `${label} → useSuspenseQuery() (1.x useQuery suspended)${options === undefined ? "" : "; options passed directly instead of { useQueryOptions }"}`,
      ANCHORS.react,
    );
  };

  // --- §5: hooks and middlewares take one context object ---------------------------------

  /** A single parameter that is already a 2.0 context: `({ raw, parsed })`, `(ctx)`, `(c: MiddlewareContext)`. */
  const isContextParameter = (params: readonly TS.ParameterDeclaration[]): boolean => {
    const [param] = params;
    if (!param || params.length !== 1) return false;
    if (param.type && /Context\b/.test(text(param.type))) return true;
    if (ts.isIdentifier(param.name)) return /^_?(ctx|context)$/i.test(param.name.text);
    if (!ts.isObjectBindingPattern(param.name) || param.name.elements.length === 0) return false;
    return param.name.elements.every((element) => {
      if (element.dotDotDotToken) return true;
      const key = element.propertyName
        ? propertyNameText(element.propertyName, ts)
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined;
      return key !== undefined && CONTEXT_FIELDS.has(key);
    });
  };

  const rewriteParameters = (
    fn: TS.ArrowFunction | TS.FunctionExpression,
    kind: HookKind,
    contextuallyTyped: boolean,
  ) => {
    const [first, ...others] = fn.parameters;
    const thisParam =
      first && ts.isIdentifier(first.name) && first.name.text === "this" ? first : undefined;
    const params = thisParam ? others : [...fn.parameters];
    const [head] = params;
    if (!head || isContextParameter(params)) return;
    const keys = HOOK_KEYS[kind];
    const label = HOOK_LABELS[kind];
    const byHand = `rewrite it to take one context object, e.g. ${exampleFor(kind)}`;
    const rest = params.find((param) => param.dotDotDotToken);
    if (rest) return addManual(rest, `${label} with a rest parameter: ${byHand}`, ANCHORS.hooks);
    const withDefault = params.find((param) => param.initializer);
    if (withDefault) {
      return addManual(withDefault, `${label} with a default value: ${byHand}`, ANCHORS.hooks);
    }
    const extra = params[keys.length];
    if (extra) {
      return addManual(
        extra,
        `${label} declares more parameters than 1.x passed (${keys.join(", ")}): ${byHand}`,
        ANCHORS.hooks,
      );
    }

    const fields = params.map((param, index) => {
      const key = keys[index] ?? "";
      if (ts.isIdentifier(param.name)) {
        return param.name.text === key ? key : `${key}: ${param.name.text}`;
      }
      return `${key}: ${text(param.name)}`;
    });
    let list = `{ ${fields.join(", ")} }`;
    let note = "";
    if (params.some((param) => param.type)) {
      if (contextuallyTyped) {
        note = "; dropped the parameter types (meteor-rpc infers the context type)";
      } else {
        // Not passed inline, so nothing infers the context type: keep the user's types.
        const types = params.map(
          (param, index) => `${keys[index]}: ${param.type ? text(param.type) : "unknown"}`,
        );
        list += `: { ${types.join("; ")} }`;
        note = "; kept the parameter types on the context object";
      }
    }

    const before = params.map(text).join(", ");
    const replacement = thisParam ? `${text(thisParam)}, ${list}` : list;
    const children = fn.getChildren(sf);
    const open = children.find((child) => child.kind === ts.SyntaxKind.OpenParenToken);
    const close = children.find((child) => child.kind === ts.SyntaxKind.CloseParenToken);
    if (open && close) {
      replace(open.getEnd(), close.getStart(sf), replacement);
    } else {
      // `raw => …`
      replace(head.getStart(sf), head.getEnd(), `(${replacement})`);
    }
    addChange(
      head,
      `${label}: (${shorten(before)}) → ({ ${shorten(fields.join(", "))} })${note}`,
      ANCHORS.hooks,
    );
  };

  const migrateHook = (element: TS.Expression, kind: HookKind, contextuallyTyped: boolean) => {
    const label = HOOK_LABELS[kind];
    if (ts.isOmittedExpression(element)) return;
    if (ts.isSpreadElement(element)) {
      return addManual(
        element,
        `${label}s spread from ${shorten(text(element.expression))}: make each one take one context object, e.g. ${exampleFor(kind)}`,
        ANCHORS.hooks,
      );
    }
    const fn = unwrap(element, ts);
    if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      if (migratedFunctions.has(fn)) return;
      migratedFunctions.add(fn);
      return rewriteParameters(fn, kind, contextuallyTyped);
    }
    if (ts.isIdentifier(fn)) {
      return addManual(
        fn,
        `update the signature of ${fn.text}: ${label}s now receive one context object, e.g. ${exampleFor(kind)}`,
        ANCHORS.hooks,
      );
    }
    addManual(
      fn,
      `update the ${label} created by ${shorten(text(fn))}: it now receives one context object, e.g. ${exampleFor(kind)}`,
      ANCHORS.hooks,
    );
  };

  const migrateHookList = (list: TS.Expression, kind: HookKind, contextuallyTyped: boolean) => {
    const array = resolveLiteral(list, ts.isArrayLiteralExpression);
    if (!array) {
      return addManual(
        list,
        `${HOOK_LABELS[kind]}s in ${shorten(text(list))}: make each one take one context object, e.g. ${exampleFor(kind)}`,
        ANCHORS.hooks,
      );
    }
    const inline = contextuallyTyped && !array.followed;
    for (const element of array.node.elements) migrateHook(element, kind, inline);
  };

  const migrateConfig = (config: TS.Expression) => {
    const object = resolveLiteral(config, ts.isObjectLiteralExpression);
    if (!object) {
      if (isUndefined(config)) return;
      return addManual(
        config,
        `config ${shorten(text(config))} isn't defined in this file: if it has hooks, make each one take one context object`,
        ANCHORS.hooks,
      );
    }
    const hooksProperty = findProperty(object.node, "hooks", ts);
    if (!hooksProperty) return;
    const hooks = resolveLiteral(propertyValue(hooksProperty, ts), ts.isObjectLiteralExpression);
    if (!hooks) {
      return addManual(
        hooksProperty,
        "hooks aren't an object literal in this file: make each hook take one context object",
        ANCHORS.hooks,
      );
    }
    for (const property of hooks.node.properties) {
      if (ts.isSpreadAssignment(property)) {
        addManual(
          property,
          `hooks spread from ${shorten(text(property.expression))}: make each hook take one context object`,
          ANCHORS.hooks,
        );
      }
    }
    const contextuallyTyped = !object.followed && !hooks.followed;
    for (const name of HOOK_NAMES) {
      const property = findProperty(hooks.node, name, ts);
      if (property) migrateHookList(propertyValue(property, ts), name, contextuallyTyped);
    }
  };

  // --- §12: build() on a namespaced module ----------------------------------------------

  const moduleRoot = (expr: TS.Expression): TS.CallExpression | undefined => {
    let current = expr;
    const seen = new Set<TS.Node>();
    for (;;) {
      current = unwrap(current, ts);
      if (seen.has(current)) return undefined;
      seen.add(current);
      if (ts.isCallExpression(current)) {
        if (refersToRpcExport(current.expression, "createModule", imports, ts)) return current;
        current = current.expression;
      } else if (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
      } else if (ts.isIdentifier(current)) {
        const initializer = declarations.constInitializer(current.text);
        if (!initializer) return undefined;
        current = initializer;
      } else {
        return undefined;
      }
    }
  };

  const checkBuild = (callee: TS.PropertyAccessExpression) => {
    const root = moduleRoot(callee.expression);
    const namespace = root?.arguments[0];
    if (!namespace || isUndefined(namespace)) return;
    addManual(
      callee.name,
      `build() on a namespaced module (createModule(${shorten(text(namespace), 30)})) throws in 2.0: end it with buildSubmodule() and add it to the root module with addSubmodule()`,
      ANCHORS.build,
    );
  };

  // --- §10: shared publications return named cursors ------------------------------------

  const returnedArray = (fn: TS.FunctionLikeDeclaration): TS.Node | undefined => {
    const body = fn.body;
    if (!body) return undefined;
    if (!ts.isBlock(body)) {
      const value = unwrap(body as TS.Expression, ts);
      return ts.isArrayLiteralExpression(value) ? value : undefined;
    }
    let found: TS.Node | undefined;
    const search = (node: TS.Node): void => {
      if (found || ts.isFunctionLike(node) || ts.isClassLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) {
        const value = unwrap(node.expression, ts);
        if (ts.isArrayLiteralExpression(value)) {
          found = value;
          return;
        }
      }
      ts.forEachChild(node, search);
    };
    ts.forEachChild(body, search);
    return found;
  };

  const checkSharedPublication = (call: TS.CallExpression) => {
    const [name, , resolver] = call.arguments;
    if (!resolver) return;
    const value = unwrap(resolver, ts);
    const fn =
      ts.isArrowFunction(value) || ts.isFunctionExpression(value)
        ? value
        : ts.isIdentifier(value)
          ? declarations.functionNamed(value.text)
          : undefined;
    const array = fn && returnedArray(fn);
    if (!array) return;
    const label =
      name && ts.isStringLiteralLike(name)
        ? `shared publication "${name.text}"`
        : "this shared publication";
    addManual(
      array,
      `${label} returns an array of cursors: return an object with one key per cursor, e.g. { rooms: Rooms.find(), users: Users.find() }; usePublication() then returns data.rooms and data.users`,
      ANCHORS.shared,
    );
  };

  /** `createClient<Server>()` → `createClient<Server>({ suspense: true })` (--suspense-client). */
  const addSuspenseOption = (call: TS.CallExpression) => {
    const change = () =>
      addChange(
        call.expression,
        "createClient() → createClient({ suspense: true }): useQuery keeps suspending, like 1.x",
        ANCHORS.react,
      );
    const [first, ...rest] = call.arguments;
    if (!first) {
      replace(call.arguments.pos, call.arguments.end, "{ suspense: true }");
      return change();
    }
    if (rest.length === 0 && ts.isObjectLiteralExpression(first)) {
      const existing = findProperty(first, "suspense", ts);
      if (existing) {
        const value = propertyValue(existing, ts);
        if (value && value.kind === ts.SyntaxKind.TrueKeyword) return;
      } else if (first.properties.length === 0) {
        replace(first.getStart(sf), first.getEnd(), "{ suspense: true }");
        return change();
      } else {
        // Last, so a spread before it (`{ ...options }`) can't turn it off.
        const last = first.properties[first.properties.length - 1]!;
        replace(last.getEnd(), last.getEnd(), ", suspense: true");
        return change();
      }
    }
    addManual(
      call.expression,
      "pass { suspense: true } to this createClient() call: useQuery then keeps suspending, like 1.x",
      ANCHORS.react,
    );
  };

  // --- walk --------------------------------------------------------------------------------

  const visitCall = (call: TS.CallExpression) => {
    const callee = call.expression;
    if (
      suspenseClient &&
      refersToRpcExport(callee, "createClient", imports, ts, REACT_CLIENT_SPECIFIERS)
    ) {
      return addSuspenseOption(call);
    }
    if (!ts.isPropertyAccessExpression(callee)) return;
    const method = callee.name.text;
    if (method === "useQuery") {
      if (isClientChain(callee.expression)) migrateUseQuery(call, callee);
      return;
    }
    if (!usesRpc) return;
    const legacy = LEGACY_METHOD_HELPERS.get(method);
    if (legacy) return addManual(callee.name, legacy.message, legacy.anchor);
    if (method === "build" && call.arguments.length === 0) return checkBuild(callee);
    if (!buildsModules) return;
    if (method === "addMiddlewares") {
      const [list] = call.arguments;
      if (list) migrateHookList(list, "middleware", true);
    } else if (
      method === "addMethod" ||
      method === "addPublication" ||
      method === "addSharedPublication"
    ) {
      const config = call.arguments[3];
      if (config) migrateConfig(config);
      if (method === "addSharedPublication") checkSharedPublication(call);
    }
  };

  const visitQualifiedReference = (namespace: TS.Node, name: string, node: TS.Node) => {
    if (!ts.isIdentifier(namespace) || !imports.namespaces.has(namespace.text)) return;
    const message = REMOVED_EXPORTS.get(name);
    if (message) addManual(node, message, ANCHORS.removed);
  };

  const visit = (node: TS.Node): void => {
    if (ts.isCallExpression(node)) {
      visitCall(node);
    } else if (ts.isPropertyAccessExpression(node)) {
      visitQualifiedReference(node.expression, node.name.text, node);
      const parent = node.parent;
      const called = ts.isCallExpression(parent) && parent.expression === node;
      if (
        !suspenseClient &&
        node.name.text === "useQuery" &&
        !called &&
        isClientChain(node.expression)
      ) {
        addManual(
          node.name,
          `${shorten(text(node))} is referenced without being called: in 2.0 useQuery() doesn't suspend, useSuspenseQuery() keeps the 1.x behavior`,
          ANCHORS.react,
        );
      }
    } else if (ts.isQualifiedName(node)) {
      visitQualifiedReference(node.left, node.right.text, node);
    } else if (
      usesRpc &&
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      propertyNameText(node.name, ts) === "onErrorResolve"
    ) {
      addManual(node.name, ERROR_HOOK_MESSAGE, ANCHORS.errors);
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === "__isError__") {
      addManual(node, IS_ERROR_MESSAGE, ANCHORS.errors);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  // Keep the first of overlapping edits (none are expected; this guards the output).
  const kept: TextEdit[] = [];
  for (const edit of [...edits].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = kept[kept.length - 1];
    if (!previous || edit.start >= previous.end) kept.push(edit);
  }
  const byPosition = (a: Finding, b: Finding) => a.line - b.line || a.column - b.column;
  return {
    output: applyEdits(sourceText, kept),
    changes: changes.sort(byPosition),
    manual: manual.sort(byPosition),
    edits: kept,
  };
}
