#!/usr/bin/env node
// Type-checks the tsconfig.json project in the current directory with the TypeScript installed
// there, and prints its errors like `tsc -p . --noEmit --pretty false`. Exits 1 on any error.
//
// tsc reports only syntax errors when any file has one, so one unparseable docs block would hide
// the type errors of every other block (scripts/docs-snippets.mjs). Here a file with syntax errors
// reports those, and every other file reports its type errors.

import { createRequire } from "node:module";
import path from "node:path";

const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");

const config = ts.getParsedCommandLineOfConfigFile("tsconfig.json", undefined, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  },
});
const program = ts.createProgram({
  rootNames: config.fileNames,
  options: config.options,
  projectReferences: config.projectReferences,
  configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(config),
});

const diagnostics = [
  ...program.getConfigFileParsingDiagnostics(),
  ...program.getOptionsDiagnostics(),
];
for (const file of program.getSourceFiles()) {
  const syntax = program.getSyntacticDiagnostics(file);
  diagnostics.push(...(syntax.length > 0 ? syntax : program.getSemanticDiagnostics(file)));
}
diagnostics.push(...program.getGlobalDiagnostics());

process.stdout.write(
  ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => ts.sys.newLine,
  }),
);
process.exitCode = diagnostics.length > 0 ? 1 : 0;
