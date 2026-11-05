/// <reference types="node" />
// Finds the meteor-rpc clients of an app across files. A client is a binding initialized with
// `createClient<Server>()` from "meteor-rpc" (or "meteor-rpc/react"). It's usually exported from
// one file and imported everywhere else, through a relative path, a Meteor absolute path such
// as "/imports/api/client" (relative to the app root) or a tsconfig `paths` alias such as
// "@/imports/api/client". Re-exports are followed. The same lookup finds 1.x submodules
// (`createModule("x")...buildSubmodule()`), whose method calls become `createCaller`. Other files
// are read lazily through a ProjectHost, so the transform itself stays free of file system access.
import * as path from "node:path";
import type * as TS from "typescript";
import {
  parseFile,
  REACT_CLIENT_SPECIFIERS,
  type RpcImports,
  refersToRpcExport,
  scanRpcImports,
  type TypeScript,
  unwrap,
} from "./ast.js";

/** How the project reads other files. cli.ts uses the file system; tests can use memory. */
export interface ProjectHost {
  /** Whether a regular file exists. */
  fileExists(fileName: string): boolean;
  readFile(fileName: string): string | undefined;
  /** Directory that Meteor absolute imports ("/imports/...") are relative to. */
  appRoot(fileName: string): string | undefined;
  /** The tsconfig `paths` that apply to `fileName`, if any. */
  pathAliases?(fileName: string): PathAliases | undefined;
}

/** `compilerOptions.paths` of a tsconfig, with the directory its targets are relative to. */
export interface PathAliases {
  readonly baseDir: string;
  readonly paths: Readonly<Record<string, readonly string[]>>;
}

export interface Project {
  /**
   * Resolves a relative, Meteor absolute or tsconfig `paths` import to a file name. Packages
   * resolve to undefined.
   */
  resolve(fromFile: string, specifier: string): string | undefined;
  /** Export names of `fileName` that are meteor-rpc clients ("default" for a default export). */
  clientExports(fileName: string): ReadonlySet<string>;
  /** Export names of `fileName` that are submodules, `createModule("x")...buildSubmodule()`. */
  submoduleExports(fileName: string): ReadonlySet<string>;
}

/** An imported name: `import { imported as local } from "specifier"`. */
export interface ImportedName {
  readonly specifier: string;
  /** "default" for default imports. */
  readonly imported: string;
}

export interface ReExport {
  readonly specifier: string;
  readonly imported: string;
  readonly exported: string;
}

/** What one file declares, imports and exports, as far as client tracking is concerned. */
export interface ModuleFacts {
  /** Local names bound to `createClient()` (anywhere in the file). */
  readonly clientLocals: ReadonlySet<string>;
  /** Local names bound to a `createModule("x")...buildSubmodule()` chain. */
  readonly submoduleLocals: ReadonlySet<string>;
  /** Exported name -> local name. */
  readonly exports: ReadonlyMap<string, string>;
  /** Local name -> imported name, including type-only imports. */
  readonly imports: ReadonlyMap<string, ImportedName>;
  /** `import * as local from "specifier"`: local name -> specifier. */
  readonly namespaceImports: ReadonlyMap<string, string>;
  /** `export { imported as exported } from "specifier"`. */
  readonly reexports: readonly ReExport[];
  /** `export * from "specifier"`. */
  readonly starExports: readonly string[];
}

/** Clients usable in a file: plain identifiers, and namespace imports of modules exporting clients. */
export interface ClientBindings {
  readonly locals: ReadonlySet<string>;
  /** Namespace local name -> its export names that are clients. */
  readonly namespaces: ReadonlyMap<string, ReadonlySet<string>>;
  /** Imported client (local or namespace name) -> the file it's imported from. */
  readonly origins: ReadonlyMap<string, string>;
}

// Local name standing for `export default createClient<Server>()`. Not a valid identifier.
const DEFAULT_CLIENT = "*default*";
const EMPTY: ReadonlySet<string> = new Set();
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

export function collectModuleFacts(
  sf: TS.SourceFile,
  ts: TypeScript,
  rpcImports: RpcImports = scanRpcImports(sf, ts),
): ModuleFacts {
  const clientLocals = new Set<string>();
  const submoduleLocals = new Set<string>();
  const exports = new Map<string, string>();
  const imports = new Map<string, ImportedName>();
  const namespaceImports = new Map<string, string>();
  const reexports: ReExport[] = [];
  const starExports: string[] = [];

  const isClientCreation = (expr: TS.Expression | undefined): boolean => {
    if (!expr) return false;
    const value = unwrap(expr, ts);
    return (
      ts.isCallExpression(value) &&
      refersToRpcExport(value.expression, "createClient", rpcImports, ts, REACT_CLIENT_SPECIFIERS)
    );
  };

  /** `createModule("x")…buildSubmodule()`: a call of `buildSubmodule` on a createModule chain. */
  const isSubmoduleCreation = (expr: TS.Expression | undefined): boolean => {
    if (!expr) return false;
    const value = unwrap(expr, ts);
    if (!ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression))
      return false;
    if (value.expression.name.text !== "buildSubmodule") return false;
    let current: TS.Expression = value.expression.expression;
    for (;;) {
      current = unwrap(current, ts);
      if (ts.isCallExpression(current)) {
        if (refersToRpcExport(current.expression, "createModule", rpcImports, ts)) return true;
        current = current.expression;
      } else if (ts.isPropertyAccessExpression(current)) {
        current = current.expression;
      } else {
        return false;
      }
    }
  };

  const visit = (node: TS.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (isClientCreation(node.initializer)) clientLocals.add(node.name.text);
      else if (isSubmoduleCreation(node.initializer)) submoduleLocals.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  if (rpcImports.specifiers.length > 0) visit(sf);

  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const literal = statement.moduleSpecifier;
      // Type-only imports count too: `import type { api }` feeds `typeof api.x.useQuery`.
      if (!clause || !ts.isStringLiteralLike(literal)) continue;
      const specifier = literal.text;
      if (clause.name) imports.set(clause.name.text, { specifier, imported: "default" });
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceImports.set(bindings.name.text, specifier);
      } else if (bindings) {
        for (const element of bindings.elements) {
          imports.set(element.name.text, {
            specifier,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.set(declaration.name.text, declaration.name.text);
        }
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const literal = statement.moduleSpecifier;
      const clause = statement.exportClause;
      if (literal && ts.isStringLiteralLike(literal)) {
        if (!clause) starExports.push(literal.text);
        else if (ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (element.isTypeOnly) continue;
            reexports.push({
              specifier: literal.text,
              imported: (element.propertyName ?? element.name).text,
              exported: element.name.text,
            });
          }
        }
      } else if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          if (element.isTypeOnly) continue;
          exports.set(element.name.text, (element.propertyName ?? element.name).text);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const value = unwrap(statement.expression, ts);
      if (ts.isIdentifier(value)) {
        exports.set("default", value.text);
      } else if (isClientCreation(value)) {
        clientLocals.add(DEFAULT_CLIENT);
        exports.set("default", DEFAULT_CLIENT);
      }
    }
  }
  return {
    clientLocals,
    submoduleLocals,
    exports,
    imports,
    namespaceImports,
    reexports,
    starExports,
  };
}

export function createProject(ts: TypeScript, host: ProjectHost): Project {
  const resolve = (fromFile: string, specifier: string): string | undefined => {
    if (specifier === "." || specifier === ".." || /^\.\.?\//.test(specifier)) {
      return findFile(path.resolve(path.dirname(fromFile), specifier));
    }
    if (specifier.startsWith("/")) {
      const root = host.appRoot(fromFile);
      return root === undefined ? undefined : findFile(path.join(root, specifier));
    }
    const aliases = host.pathAliases?.(fromFile);
    return aliases ? resolveAlias(aliases, specifier) : undefined;
  };

  /** Like TypeScript: the pattern with the longest prefix before its `*` wins. */
  const resolveAlias = (aliases: PathAliases, specifier: string): string | undefined => {
    let best: { targets: readonly string[]; captured: string; prefix: number } | undefined;
    for (const [pattern, targets] of Object.entries(aliases.paths)) {
      const star = pattern.indexOf("*");
      if (star === -1) {
        if (pattern === specifier) return firstTarget(aliases, targets, "");
        continue;
      }
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        specifier.length >= prefix.length + suffix.length &&
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        (!best || prefix.length > best.prefix)
      ) {
        const captured = specifier.slice(prefix.length, specifier.length - suffix.length);
        best = { targets, captured, prefix: prefix.length };
      }
    }
    return best ? firstTarget(aliases, best.targets, best.captured) : undefined;
  };

  const firstTarget = (aliases: PathAliases, targets: readonly string[], captured: string) => {
    for (const target of targets) {
      const found = findFile(path.resolve(aliases.baseDir, target.replace("*", captured)));
      if (found) return found;
    }
    return undefined;
  };

  const findFile = (base: string): string | undefined => {
    const candidates = [base];
    // TypeScript lets "./client.js" point at client.ts.
    const jsExtension = /\.([cm]?)js(x?)$/.exec(base);
    if (jsExtension) {
      const stem = base.slice(0, -jsExtension[0].length);
      candidates.push(`${stem}.${jsExtension[1]}ts${jsExtension[2]}`);
      if (jsExtension[0] === ".js") candidates.push(`${stem}.tsx`);
    }
    for (const extension of EXTENSIONS) candidates.push(base + extension);
    for (const extension of EXTENSIONS) candidates.push(path.join(base, `index${extension}`));
    return candidates.find((candidate) => host.fileExists(candidate));
  };

  const factsCache = new Map<string, ModuleFacts | undefined>();
  const factsOf = (fileName: string): ModuleFacts | undefined => {
    if (!factsCache.has(fileName)) {
      const text = host.readFile(fileName);
      factsCache.set(
        fileName,
        text?.includes("export")
          ? collectModuleFacts(parseFile(fileName, text, ts), ts)
          : undefined,
      );
    }
    return factsCache.get(fileName);
  };

  /** Export names of a file whose local is of one kind (`localsOf`), following re-exports. */
  const exportFinder = (localsOf: (facts: ModuleFacts) => ReadonlySet<string>) => {
    const cache = new Map<string, ReadonlySet<string>>();
    const pending = new Set<string>();
    const find = (fileName: string): ReadonlySet<string> => {
      const cached = cache.get(fileName);
      if (cached) return cached;
      if (pending.has(fileName)) return EMPTY; // import cycle
      pending.add(fileName);
      const facts = factsOf(fileName);
      const result = new Set<string>();
      if (facts) {
        const isImportOfKind = (imported: ImportedName) => {
          const target = resolve(fileName, imported.specifier);
          return target !== undefined && find(target).has(imported.imported);
        };
        for (const [exported, local] of facts.exports) {
          const imported = facts.imports.get(local);
          if (localsOf(facts).has(local) || (imported && isImportOfKind(imported))) {
            result.add(exported);
          }
        }
        for (const reexport of facts.reexports) {
          if (isImportOfKind(reexport)) result.add(reexport.exported);
        }
        for (const specifier of facts.starExports) {
          const target = resolve(fileName, specifier);
          if (!target) continue;
          for (const name of find(target)) if (name !== "default") result.add(name);
        }
      }
      pending.delete(fileName);
      cache.set(fileName, result);
      return result;
    };
    return find;
  };

  return {
    resolve,
    clientExports: exportFinder((facts) => facts.clientLocals),
    submoduleExports: exportFinder((facts) => facts.submoduleLocals),
  };
}

/** Which identifiers of a file are meteor-rpc clients, created there or imported. */
export function clientBindings(
  project: Project,
  fileName: string,
  facts: ModuleFacts,
): ClientBindings {
  const locals = new Set(facts.clientLocals);
  const origins = new Map<string, string>();
  for (const [local, imported] of facts.imports) {
    const target = project.resolve(fileName, imported.specifier);
    if (target && project.clientExports(target).has(imported.imported)) {
      locals.add(local);
      origins.set(local, target);
    }
  }
  const namespaces = new Map<string, ReadonlySet<string>>();
  for (const [local, specifier] of facts.namespaceImports) {
    const target = project.resolve(fileName, specifier);
    const names = target ? project.clientExports(target) : EMPTY;
    if (names.size > 0) {
      namespaces.set(local, names);
      if (target) origins.set(local, target);
    }
  }
  return { locals, namespaces, origins };
}
