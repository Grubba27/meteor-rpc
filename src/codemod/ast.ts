// Syntax helpers shared by the codemod: what a file imports from meteor-rpc, unwrapping
// parentheses and casts, following `const` declarations within a file, and report positions.
// Only syntax is used (ts.createSourceFile); there is no type checker.
import type * as TS from "typescript";

/** The `typescript` module. The codemod loads it at runtime (see cli.ts); it's never bundled. */
export type TypeScript = typeof TS;

/** Import specifier of the 1.x Atmosphere package. The codemod rewrites it to "meteor-rpc". */
export const ATMOSPHERE_SPECIFIER = "meteor/grubba:rpc";

/** Entry points whose `createClient` has React hooks (1.x only had the root one). */
export const REACT_CLIENT_SPECIFIERS: readonly string[] = [
  "meteor-rpc",
  "meteor-rpc/react",
  ATMOSPHERE_SPECIFIER,
];

/** Whether an import specifier names meteor-rpc: any entry point, or the 1.x Atmosphere package. */
export function isRpcSpecifier(specifier: string): boolean {
  return (
    specifier === "meteor-rpc" ||
    specifier.startsWith("meteor-rpc/") ||
    specifier === ATMOSPHERE_SPECIFIER
  );
}

/** One name imported or re-exported from meteor-rpc. */
export interface RpcBinding {
  /** Name exported by meteor-rpc, e.g. "createModule". */
  readonly imported: string;
  /** Name in this file. */
  readonly local: string;
  readonly specifier: string;
  /** Where to report it. */
  readonly node: TS.Node;
}

/** What a file imports from meteor-rpc. */
export interface RpcImports {
  /** Named imports and `require` destructuring, by local name. */
  readonly named: ReadonlyMap<string, RpcBinding>;
  /** Namespace, default and `require` bindings (local name -> specifier). */
  readonly namespaces: ReadonlyMap<string, string>;
  /** Named imports and re-exports, in source order. */
  readonly bindings: readonly RpcBinding[];
  /** Every string literal naming a meteor-rpc module. Empty when the file doesn't use meteor-rpc. */
  readonly specifiers: readonly TS.StringLiteralLike[];
}

export function parseFile(fileName: string, text: string, ts: TypeScript): TS.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName, ts),
  );
}

function scriptKind(fileName: string, ts: TypeScript): TS.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  // Plain .js files are parsed with JSX enabled, as Meteor's Babel config does.
  if (/\.[cm]?js$/.test(lower)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** The first syntax error of a parsed file. `parseDiagnostics` is internal but stable since TS 2. */
export function firstSyntaxError(sf: TS.SourceFile): TS.DiagnosticWithLocation | undefined {
  const { parseDiagnostics } = sf as unknown as {
    parseDiagnostics?: readonly TS.DiagnosticWithLocation[];
  };
  return parseDiagnostics?.[0];
}

/** `require("x")` → the "x" literal. */
export function requiredSpecifier(
  expr: TS.Expression | undefined,
  ts: TypeScript,
): TS.StringLiteralLike | undefined {
  if (!expr || !ts.isCallExpression(expr)) return undefined;
  const [arg] = expr.arguments;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== "require") return undefined;
  return expr.arguments.length === 1 && arg && ts.isStringLiteralLike(arg) ? arg : undefined;
}

export function scanRpcImports(sf: TS.SourceFile, ts: TypeScript): RpcImports {
  const named = new Map<string, RpcBinding>();
  const namespaces = new Map<string, string>();
  const bindings: RpcBinding[] = [];
  const specifiers: TS.StringLiteralLike[] = [];

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const literal = statement.moduleSpecifier;
      if (!ts.isStringLiteralLike(literal) || !isRpcSpecifier(literal.text)) continue;
      specifiers.push(literal);
      const clause = statement.importClause;
      if (clause?.name) namespaces.set(clause.name.text, literal.text);
      const imported = clause?.namedBindings;
      if (imported && ts.isNamespaceImport(imported)) {
        namespaces.set(imported.name.text, literal.text);
      } else if (imported) {
        for (const element of imported.elements) {
          const binding: RpcBinding = {
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
            specifier: literal.text,
            node: element,
          };
          named.set(binding.local, binding);
          bindings.push(binding);
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      const literal = statement.moduleSpecifier;
      if (!literal || !ts.isStringLiteralLike(literal) || !isRpcSpecifier(literal.text)) continue;
      specifiers.push(literal);
      const clause = statement.exportClause;
      if (!clause || !ts.isNamedExports(clause)) continue;
      for (const element of clause.elements) {
        bindings.push({
          imported: (element.propertyName ?? element.name).text,
          local: element.name.text,
          specifier: literal.text,
          node: element,
        });
      }
    } else if (ts.isImportEqualsDeclaration(statement)) {
      const reference = statement.moduleReference;
      if (!ts.isExternalModuleReference(reference)) continue;
      const literal = reference.expression;
      if (!ts.isStringLiteralLike(literal) || !isRpcSpecifier(literal.text)) continue;
      specifiers.push(literal);
      namespaces.set(statement.name.text, literal.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const literal = requiredSpecifier(declaration.initializer, ts);
        if (!literal || !isRpcSpecifier(literal.text)) continue;
        specifiers.push(literal);
        if (ts.isIdentifier(declaration.name)) {
          namespaces.set(declaration.name.text, literal.text);
          continue;
        }
        if (!ts.isObjectBindingPattern(declaration.name)) continue;
        for (const element of declaration.name.elements) {
          if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
          const key = element.propertyName ? propertyNameText(element.propertyName, ts) : undefined;
          const binding: RpcBinding = {
            imported: key ?? element.name.text,
            local: element.name.text,
            specifier: literal.text,
            node: element,
          };
          named.set(binding.local, binding);
          bindings.push(binding);
        }
      }
    }
  }
  return { named, namespaces, bindings, specifiers };
}

/** Whether `expr` names a meteor-rpc export: `createModule`, or `rpc.createModule` for a namespace import. */
export function refersToRpcExport(
  expr: TS.Expression,
  exportName: string,
  imports: RpcImports,
  ts: TypeScript,
  specifiers?: readonly string[],
): boolean {
  const allowed = (specifier: string) => !specifiers || specifiers.includes(specifier);
  if (ts.isIdentifier(expr)) {
    const binding = imports.named.get(expr.text);
    return binding?.imported === exportName && allowed(binding.specifier);
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.name.text === exportName
  ) {
    const specifier = imports.namespaces.get(expr.expression.text);
    return specifier !== undefined && allowed(specifier);
  }
  return false;
}

/** Strips parentheses, `as`, `satisfies`, `!` and `<T>` casts. */
export function unwrap(expr: TS.Expression, ts: TypeScript): TS.Expression {
  let current = expr;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** Text of a static property name (`a`, `"a"`, `1`), or undefined for computed and private names. */
export function propertyNameText(name: TS.Node, ts: TypeScript): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** The last `key: value` or shorthand `key` property named `key` (the one JavaScript keeps). */
export function findProperty(
  object: TS.ObjectLiteralExpression,
  key: string,
  ts: TypeScript,
): TS.PropertyAssignment | TS.ShorthandPropertyAssignment | undefined {
  let found: TS.PropertyAssignment | TS.ShorthandPropertyAssignment | undefined;
  for (const property of object.properties) {
    if (
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      propertyNameText(property.name, ts) === key
    ) {
      found = property;
    }
  }
  return found;
}

export function propertyValue(
  property: TS.PropertyAssignment | TS.ShorthandPropertyAssignment,
  ts: TypeScript,
): TS.Expression {
  return ts.isPropertyAssignment(property) ? property.initializer : property.name;
}

/** Lookups of declarations by name within one file. Scopes are ignored, so names must be unique. */
export interface Declarations {
  /** Initializer of the only declaration of `name` in the file, when it's a `const`. */
  constInitializer(name: string): TS.Expression | undefined;
  /** The only declaration of `name`, when it's a function declaration or a `const` function. */
  functionNamed(name: string): TS.FunctionLikeDeclaration | undefined;
}

export function indexDeclarations(sf: TS.SourceFile, ts: TypeScript): Declarations {
  const byName = new Map<string, TS.Node[]>();
  const add = (name: TS.Node | undefined, declaration: TS.Node) => {
    if (!name || !ts.isIdentifier(name)) return;
    const list = byName.get(name.text);
    if (list) list.push(declaration);
    else byName.set(name.text, [declaration]);
  };
  const visit = (node: TS.Node): void => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isClassDeclaration(node) ||
      ts.isImportSpecifier(node) ||
      ts.isImportClause(node) ||
      ts.isNamespaceImport(node)
    ) {
      add(node.name, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const only = (name: string): TS.Node | undefined => {
    const list = byName.get(name);
    return list?.length === 1 ? list[0] : undefined;
  };
  const constInitializer = (name: string): TS.Expression | undefined => {
    const node = only(name);
    if (!node || !ts.isVariableDeclaration(node) || !node.initializer) return undefined;
    const list = node.parent;
    return ts.isVariableDeclarationList(list) && list.flags & ts.NodeFlags.Const
      ? node.initializer
      : undefined;
  };
  return {
    constInitializer,
    functionNamed(name) {
      const node = only(name);
      if (node && ts.isFunctionDeclaration(node)) return node;
      const initializer = constInitializer(name);
      if (!initializer) return undefined;
      const value = unwrap(initializer, ts);
      return ts.isArrowFunction(value) || ts.isFunctionExpression(value) ? value : undefined;
    },
  };
}

/** 1-based line and column of a node's first token. */
export function positionOf(sf: TS.SourceFile, node: TS.Node): { line: number; column: number } {
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { line: line + 1, column: character + 1 };
}

/** Source text on one line, cut to `max` characters, for report messages. */
export function shorten(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
