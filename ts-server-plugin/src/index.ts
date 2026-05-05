import type * as ts from "typescript/lib/tsserverlibrary";

// Function names that register a Meteor method/publication and take the name as the first argument
const CREATOR_FUNCTIONS = new Set([
  "createMethod",
  "createMutation",
  "createQuery",
  "createPublication",
  "createRealtimeQuery",
  "createSharedRealtimeQuery",
]);

// Module builder methods that also take the name as the first argument
const MODULE_METHODS = new Set([
  "addMethod",
  "addPublication",
  "addSharedPublication",
]);

function init(modules: { typescript: typeof ts }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const log = (msg: string) =>
      info.project.projectService.logger.info(`[meteor-rpc] ${msg}`);

    log(`plugin loaded (TypeScript ${ts.version})`);

    // Build a pass-through proxy wrapping the real language service
    const proxy: ts.LanguageService = Object.create(null);
    for (const k of Object.keys(info.languageService) as Array<
      keyof ts.LanguageService
    >) {
      const x = info.languageService[k]!;
      proxy[k] = (...args: Array<unknown>) =>
        (x as Function).apply(info.languageService, args);
    }

    // Override Go-to-Definition to redirect method/publication name strings
    // back to their createMethod / addMethod call sites.
    proxy.getDefinitionAndBoundSpan = (fileName, position) => {
      const prior = info.languageService.getDefinitionAndBoundSpan(
        fileName,
        position
      );

      try {
        const program = info.languageService.getProgram();
        if (!program) { log("getDefinition: no program"); return prior; }

        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) { log(`getDefinition: no sourceFile for ${fileName}`); return prior; }

        // Find the AST node under the cursor
        const node = getNodeAtPosition(sourceFile, position);
        if (!node || !ts.isIdentifier(node)) { log(`getDefinition: no identifier at position ${position}`); return prior; }

        log(`getDefinition: identifier "${node.text}"`);

        const checker = program.getTypeChecker();

        // Resolve the type and check if it carries a `config.name` literal —
        // both ReturnMethod<Name, ...> and ReturnSubscription<Name, ...> have this.
        // Use getTypeAtLocation on the identifier node directly — this is the
        // most reliable way to get the type of a property access in TS 4 and 5.
        const type = checker.getTypeAtLocation(node);
        log(`getDefinition: type is "${checker.typeToString(type)}"`);

        const methodName = extractMethodName(type, checker, node);
        if (!methodName) { log(`getDefinition: type has no config.name — not a ReturnMethod/ReturnSubscription`); return prior; }

        log(`getDefinition: resolved method name "${methodName}" — searching project files`);

        // For submodule methods the full name is e.g. "example.exampleMethod"
        // but the call site uses the local name "exampleMethod" inside createModule("example").
        // Try the full name first, then fall back to the last dotted segment.
        const localName = methodName.includes(".")
          ? methodName.slice(methodName.lastIndexOf(".") + 1)
          : methodName;

        // Search the project for the matching registration call site
        const definition =
          findDefinition(methodName, program, sourceFile) ||
          (localName !== methodName
            ? findDefinition(localName, program, sourceFile)
            : undefined);
        if (!definition) { log(`getDefinition: no call site found for "${methodName}"`); return prior; }

        log(`getDefinition: found call site in ${definition.fileName}`);

        return {
          textSpan: ts.createTextSpanFromBounds(
            node.getStart(sourceFile),
            node.getEnd()
          ),
          definitions: [definition],
        };
      } catch (_e) {
        // Never break the language service — fall back to default behaviour
        log(`getDefinition: caught error — ${_e}`);
        return prior;
      }
    };

    return proxy;

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function getNodeAtPosition(
      sourceFile: ts.SourceFile,
      position: number
    ): ts.Node | undefined {
      function find(node: ts.Node): ts.Node | undefined {
        if (
          position >= node.getStart(sourceFile) &&
          position < node.getEnd()
        ) {
          return ts.forEachChild(node, find) || node;
        }
        return undefined;
      }
      return find(sourceFile);
    }

    /**
     * If `type` is ReturnMethod<Name, ...> or ReturnSubscription<Name, ...>,
     * returns the literal string value of the `config.name` property.
     */
    function extractMethodName(
      type: ts.Type,
      checker: ts.TypeChecker,
      contextNode: ts.Node
    ): string | undefined {
      const configProp = type.getProperty("config");
      if (!configProp) return undefined;
      const configType = checker.getTypeOfSymbolAtLocation(configProp, contextNode);

      const nameProp = configType.getProperty("name");
      if (!nameProp) return undefined;
      const nameType = checker.getTypeOfSymbolAtLocation(nameProp, contextNode);

      // The Name type parameter may be a union like:
      //   "createChatRoom" | `${string}.createChatRoom`
      // Pick the first plain string-literal member from the union.
      if (nameType.isStringLiteral()) return nameType.value;
      if (nameType.isUnion()) {
        for (const member of nameType.types) {
          if (member.isStringLiteral()) return member.value;
        }
      }

      return undefined;
    }

    /**
     * Walks all (non-declaration) source files in the program looking for a
     * createMethod / addMethod / etc. call whose first argument matches
     * `methodName`. Current file is searched first.
     */
    function findDefinition(
      methodName: string,
      program: ts.Program,
      currentFile: ts.SourceFile
    ): ts.DefinitionInfo | undefined {
      const otherFiles = program
        .getSourceFiles()
        .filter((f) => f !== currentFile && !f.isDeclarationFile);

      for (const sourceFile of [currentFile, ...otherFiles]) {
        const result = findInFile(sourceFile, methodName);
        if (result) return result;
      }
      return undefined;
    }

    function findInFile(
      sourceFile: ts.SourceFile,
      methodName: string
    ): ts.DefinitionInfo | undefined {
      function visit(node: ts.Node): ts.DefinitionInfo | undefined {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          const isTargetCall =
            (ts.isIdentifier(callee) && CREATOR_FUNCTIONS.has(callee.text)) ||
            (ts.isPropertyAccessExpression(callee) &&
              MODULE_METHODS.has(callee.name.text));

          if (isTargetCall && node.arguments.length > 0) {
            const firstArg = node.arguments[0];
            if (
              ts.isStringLiteral(firstArg) &&
              firstArg.text === methodName
            ) {
              return {
                fileName: sourceFile.fileName,
                textSpan: ts.createTextSpanFromBounds(
                  firstArg.getStart(sourceFile),
                  firstArg.getEnd()
                ),
                kind: ts.ScriptElementKind.functionElement,
                name: methodName,
                containerName: "",
                containerKind: ts.ScriptElementKind.unknown,
              };
            }
          }
        }

        return ts.forEachChild(node, visit);
      }

      return ts.forEachChild(sourceFile, visit);
    }
  }

  return { create };
}

export = init;
