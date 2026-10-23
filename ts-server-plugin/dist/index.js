"use strict";
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
// meteor-rpc 2 client helpers (api.x.useQuery, api.x.subscribe, …). meteor-rpc 2 reserves these
// names, so a property matching them is a helper, never a method, publication or module.
const RESERVED_HELPERS = new Set([
    "subscribe",
    "collection",
    "collections",
    "queryKey",
    "queryOptions",
    "mutationOptions",
]);
const isHelperName = (name) => RESERVED_HELPERS.has(name) || /^use[A-Z]/.test(name) || name.startsWith("$");
// Type names declared next to each other in meteor-rpc 2's client typings. A declaration file
// declaring a client type and a procedure type is meteor-rpc's, wherever it's installed.
const CLIENT_TYPE_NAMES = ["Client", "ReactClient"];
const PROCEDURE_TYPE_NAMES = ["MethodCaller", "ReactMethodClient"];
function init(modules) {
    const ts = modules.typescript;
    function create(info) {
        const log = (msg) => info.project.projectService.logger.info(`[meteor-rpc] ${msg}`);
        log(`plugin loaded (TypeScript ${ts.version})`);
        // Whether a declaration file is meteor-rpc 2's client typings, by source file.
        const clientTypingsFiles = new WeakMap();
        // Build a pass-through proxy wrapping the real language service
        const proxy = Object.create(null);
        for (const k of Object.keys(info.languageService)) {
            const x = info.languageService[k];
            proxy[k] = (...args) => x.apply(info.languageService, args);
        }
        // Override Go-to-Definition to redirect method/publication name strings
        // back to their createMethod / addMethod call sites.
        proxy.getDefinitionAndBoundSpan = (fileName, position) => {
            const prior = info.languageService.getDefinitionAndBoundSpan(fileName, position);
            try {
                const program = info.languageService.getProgram();
                if (!program) {
                    log("getDefinition: no program");
                    return prior;
                }
                const sourceFile = program.getSourceFile(fileName);
                if (!sourceFile) {
                    log(`getDefinition: no sourceFile for ${fileName}`);
                    return prior;
                }
                // Find the AST node under the cursor
                const node = getNodeAtPosition(sourceFile, position);
                if (!node || !ts.isIdentifier(node)) {
                    log(`getDefinition: no identifier at position ${position}`);
                    return prior;
                }
                log(`getDefinition: identifier "${node.text}"`);
                const checker = program.getTypeChecker();
                // Resolve the type and check if it carries a `config.name` literal —
                // both ReturnMethod<Name, ...> and ReturnSubscription<Name, ...> have this.
                // Use getTypeAtLocation on the identifier node directly — this is the
                // most reliable way to get the type of a property access in TS 4 and 5.
                const type = checker.getTypeAtLocation(node);
                log(`getDefinition: type is "${checker.typeToString(type)}"`);
                let definition;
                const methodName = extractMethodName(type, checker, node);
                if (methodName) {
                    log(`getDefinition: resolved method name "${methodName}" — searching project files`);
                    // For submodule methods the full name is e.g. "example.exampleMethod"
                    // but the call site uses the local name "exampleMethod" inside createModule("example").
                    // Try the full name first, then fall back to the last dotted segment.
                    const localName = methodName.includes(".")
                        ? methodName.slice(methodName.lastIndexOf(".") + 1)
                        : methodName;
                    // Search the project for the matching registration call site. For the local name,
                    // prefer the addMethod in createModule("<prefix>"): several modules can share a name.
                    definition =
                        findDefinition(methodName, program, sourceFile) ||
                            (localName !== methodName
                                ? findClientDefinition(methodName.split("."), program, sourceFile) ||
                                    findDefinition(localName, program, sourceFile)
                                : undefined);
                }
                else {
                    // meteor-rpc 2: client types don't carry the name, so rebuild it from the property chain.
                    const clientPath = extractClientPath(node, checker);
                    if (!clientPath) {
                        log(`getDefinition: not a meteor-rpc 1.x method or 2.x client member`);
                        return prior;
                    }
                    log(`getDefinition: meteor-rpc 2 ${clientPath.kind} "${clientPath.segments.map((s) => s !== null && s !== void 0 ? s : "*").join(".")}" — searching project files`);
                    definition =
                        clientPath.kind === "module"
                            ? findModuleDefinition(node.text, program, sourceFile)
                            : findClientDefinition(clientPath.segments, program, sourceFile);
                }
                if (!definition) {
                    log(`getDefinition: no call site found for "${node.text}"`);
                    return prior;
                }
                log(`getDefinition: found call site in ${definition.fileName}`);
                return {
                    textSpan: ts.createTextSpanFromBounds(node.getStart(sourceFile), node.getEnd()),
                    definitions: [definition],
                };
            }
            catch (_e) {
                // Never break the language service — fall back to default behaviour
                log(`getDefinition: caught error — ${_e}`);
                return prior;
            }
        };
        return proxy;
        // -------------------------------------------------------------------------
        // Helpers
        // -------------------------------------------------------------------------
        function getNodeAtPosition(sourceFile, position) {
            function find(node) {
                if (position >= node.getStart(sourceFile) &&
                    position < node.getEnd()) {
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
        function extractMethodName(type, checker, contextNode) {
            const configProp = type.getProperty("config");
            if (!configProp)
                return undefined;
            const configType = checker.getTypeOfSymbolAtLocation(configProp, contextNode);
            const nameProp = configType.getProperty("name");
            if (!nameProp)
                return undefined;
            const nameType = checker.getTypeOfSymbolAtLocation(nameProp, contextNode);
            // The Name type parameter may be a union like:
            //   "createChatRoom" | `${string}.createChatRoom`
            // Pick the first plain string-literal member from the union.
            if (nameType.isStringLiteral())
                return nameType.value;
            if (nameType.isUnion()) {
                for (const member of nameType.types) {
                    if (member.isStringLiteral())
                        return member.value;
                }
            }
            return undefined;
        }
        /**
         * meteor-rpc 2 clients are proxies typed with mapped types, so the procedure name isn't in
         * the type. For an identifier in `api.users.loggedUser`, returns the path from the client to
         * the identifier: ["users", "loggedUser"] (null for a computed segment such as `api[type]`),
         * and whether the identifier is a module or a method/publication. undefined if the
         * identifier isn't a member of a meteor-rpc 2 client, or is a helper (`useQuery`, …).
         */
        function extractClientPath(node, checker) {
            const parent = node.parent;
            if (!parent || !ts.isPropertyAccessExpression(parent) || parent.name !== node)
                return undefined;
            if (isHelperName(node.text))
                return undefined;
            const nodeType = checker.getTypeAtLocation(node);
            if (!isClientType(nodeType))
                return undefined;
            const segments = [node.text];
            let object = parent.expression;
            for (;;) {
                const inner = skipParentheses(object);
                // A segment is a property of a client; the client the chain starts from is not one.
                if (ts.isPropertyAccessExpression(inner) && isClientType(checker.getTypeAtLocation(inner.expression))) {
                    segments.unshift(inner.name.text);
                    object = inner.expression;
                }
                else if (ts.isElementAccessExpression(inner) && isClientType(checker.getTypeAtLocation(inner.expression))) {
                    const argument = inner.argumentExpression;
                    segments.unshift(ts.isStringLiteralLike(argument) ? argument.text : null);
                    object = inner.expression;
                }
                else {
                    break;
                }
            }
            if (!isClientType(checker.getTypeAtLocation(object)))
                return undefined;
            // Methods are callable and publications have `subscribe`; anything else is a module.
            const isProcedure = nodeType.getCallSignatures().length > 0 || nodeType.getProperty("subscribe") !== undefined;
            return { segments, kind: isProcedure ? "procedure" : "module" };
        }
        function skipParentheses(expression) {
            let current = expression;
            while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) {
                current = current.expression;
            }
            return current;
        }
        /** Whether every member of `type` is declared in meteor-rpc 2's client typings. */
        function isClientType(type) {
            const members = type.isUnion() ? type.types : [type];
            return (members.length > 0 &&
                members.every((member) => [member.aliasSymbol, member.getSymbol()].some((symbol) => {
                    var _a;
                    return (_a = symbol === null || symbol === void 0 ? void 0 : symbol.declarations) === null || _a === void 0 ? void 0 : _a.some((declaration) => isClientTypingsFile(declaration.getSourceFile()));
                })));
        }
        function isClientTypingsFile(sourceFile) {
            if (!sourceFile.isDeclarationFile)
                return false;
            const cached = clientTypingsFiles.get(sourceFile);
            if (cached !== undefined)
                return cached;
            const names = new Set();
            for (const statement of sourceFile.statements) {
                if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
                    names.add(statement.name.text);
                }
            }
            const result = CLIENT_TYPE_NAMES.some((name) => names.has(name)) &&
                PROCEDURE_TYPE_NAMES.some((name) => names.has(name));
            clientTypingsFiles.set(sourceFile, result);
            return result;
        }
        /**
         * Finds the addMethod / addPublication / addSharedPublication call registering the last
         * segment, preferring the one whose builder chain starts at createModule("<module>"), where
         * <module> is the segment before it. Falls back to any registration with that name.
         */
        function findClientDefinition(segments, program, currentFile) {
            const name = segments[segments.length - 1];
            if (name === null)
                return undefined;
            // undefined: the root module; null: unknown (computed segment).
            const moduleName = segments.length > 1 ? segments[segments.length - 2] : undefined;
            let sameModule;
            let unknownModule;
            let otherModule;
            for (const sourceFile of searchOrder(program, currentFile)) {
                forEachCall(sourceFile, (call) => {
                    const callee = call.expression;
                    if (!ts.isPropertyAccessExpression(callee) || !MODULE_METHODS.has(callee.name.text))
                        return false;
                    const firstArg = call.arguments[0];
                    if (!firstArg || !ts.isStringLiteralLike(firstArg) || firstArg.text !== name)
                        return false;
                    const definition = toDefinition(sourceFile, firstArg, name);
                    const builder = moduleOf(callee.expression);
                    if (moduleName === null || !builder.found)
                        unknownModule !== null && unknownModule !== void 0 ? unknownModule : (unknownModule = definition);
                    else if (builder.name === moduleName)
                        sameModule !== null && sameModule !== void 0 ? sameModule : (sameModule = definition);
                    else
                        otherModule !== null && otherModule !== void 0 ? otherModule : (otherModule = definition);
                    return sameModule !== undefined;
                });
                if (sameModule)
                    return sameModule;
            }
            return unknownModule !== null && unknownModule !== void 0 ? unknownModule : otherModule;
        }
        /** Finds createModule("<name>"). */
        function findModuleDefinition(name, program, currentFile) {
            for (const sourceFile of searchOrder(program, currentFile)) {
                let found;
                forEachCall(sourceFile, (call) => {
                    const firstArg = call.arguments[0];
                    if (calleeName(call) === "createModule" &&
                        firstArg &&
                        ts.isStringLiteralLike(firstArg) &&
                        firstArg.text === name) {
                        found = toDefinition(sourceFile, firstArg, name);
                        return true;
                    }
                    return false;
                });
                if (found)
                    return found;
            }
            return undefined;
        }
        /** Walks a builder chain (createModule("x").addMethod(…).addMethod) back to createModule. */
        function moduleOf(expression) {
            let current = skipParentheses(expression);
            for (;;) {
                if (ts.isCallExpression(current)) {
                    if (calleeName(current) === "createModule") {
                        const firstArg = current.arguments[0];
                        return {
                            found: true,
                            name: firstArg && ts.isStringLiteralLike(firstArg) ? firstArg.text : undefined,
                        };
                    }
                    current = skipParentheses(current.expression);
                }
                else if (ts.isPropertyAccessExpression(current)) {
                    current = skipParentheses(current.expression);
                }
                else {
                    // The builder came from a variable or a function: its module is unknown.
                    return { found: false };
                }
            }
        }
        function calleeName(call) {
            const callee = call.expression;
            if (ts.isIdentifier(callee))
                return callee.text;
            if (ts.isPropertyAccessExpression(callee))
                return callee.name.text;
            return undefined;
        }
        function searchOrder(program, currentFile) {
            const others = program
                .getSourceFiles()
                .filter((f) => f !== currentFile && !f.isDeclarationFile);
            return [currentFile, ...others];
        }
        /** Calls `visit` for each call expression until it returns true. */
        function forEachCall(sourceFile, visit) {
            const walk = (node) => (ts.isCallExpression(node) && visit(node)) || ts.forEachChild(node, walk);
            ts.forEachChild(sourceFile, walk);
        }
        function toDefinition(sourceFile, literal, name) {
            return {
                fileName: sourceFile.fileName,
                textSpan: ts.createTextSpanFromBounds(literal.getStart(sourceFile), literal.getEnd()),
                kind: ts.ScriptElementKind.functionElement,
                name,
                containerName: "",
                containerKind: ts.ScriptElementKind.unknown,
            };
        }
        /**
         * Walks all (non-declaration) source files in the program looking for a
         * createMethod / addMethod / etc. call whose first argument matches
         * `methodName`. Current file is searched first.
         */
        function findDefinition(methodName, program, currentFile) {
            const otherFiles = program
                .getSourceFiles()
                .filter((f) => f !== currentFile && !f.isDeclarationFile);
            for (const sourceFile of [currentFile, ...otherFiles]) {
                const result = findInFile(sourceFile, methodName);
                if (result)
                    return result;
            }
            return undefined;
        }
        function findInFile(sourceFile, methodName) {
            function visit(node) {
                if (ts.isCallExpression(node)) {
                    const callee = node.expression;
                    const isTargetCall = (ts.isIdentifier(callee) && CREATOR_FUNCTIONS.has(callee.text)) ||
                        (ts.isPropertyAccessExpression(callee) &&
                            MODULE_METHODS.has(callee.name.text));
                    if (isTargetCall && node.arguments.length > 0) {
                        const firstArg = node.arguments[0];
                        if (ts.isStringLiteral(firstArg) &&
                            firstArg.text === methodName) {
                            return {
                                fileName: sourceFile.fileName,
                                textSpan: ts.createTextSpanFromBounds(firstArg.getStart(sourceFile), firstArg.getEnd()),
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
module.exports = init;
