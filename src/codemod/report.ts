// Output of the codemod: a unified diff per changed file, a human-readable report grouped by file
// with a summary line, or a flat JSON list of findings for coding agents and other tools.
import { applyEdits, type Finding, type TextEdit, type TransformResult } from "./transform.js";

/** Result of migrating one file, with the name to print (relative to the working directory). */
export interface FileReport {
  readonly displayName: string;
  readonly source: string;
  readonly result: TransformResult;
}

export interface JsonFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly kind: "change" | "manual";
  readonly message: string;
  readonly anchor: string;
}

export interface ReportOptions {
  /** Changes were written to disk (otherwise it's a dry run). */
  readonly write: boolean;
  readonly color: boolean;
  /** Number of files scanned, for the summary. */
  readonly scanned: number;
}

const CONTEXT_LINES = 2;

type Paint = (code: string, text: string) => string;
const painter = (color: boolean): Paint =>
  color ? (code, text) => `\u001b[${code}m${text}\u001b[0m` : (_code, text) => text;

/** A unified diff of `edits` applied to `source`, with a few lines of context around each change. */
export function formatDiff(
  displayName: string,
  source: string,
  edits: readonly TextEdit[],
  color = false,
): string {
  if (edits.length === 0) return "";
  const paint = painter(color);
  const lineStarts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    // The final newline ends the last line; it doesn't start an empty one.
    if (index + 1 < source.length) lineStarts.push(index + 1);
  }
  const lineOf = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
  const lastLine = lineStarts.length - 1;

  // Group edits whose context overlaps into hunks.
  const hunks: { first: number; last: number; edits: TextEdit[] }[] = [];
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    const first = Math.max(0, lineOf(edit.start) - CONTEXT_LINES);
    const last = Math.min(lastLine, lineOf(edit.end) + CONTEXT_LINES);
    const previous = hunks[hunks.length - 1];
    if (previous && first <= previous.last + 1) {
      previous.last = Math.max(previous.last, last);
      previous.edits.push(edit);
    } else {
      hunks.push({ first, last, edits: [edit] });
    }
  }

  const out = [paint("1", `--- a/${displayName}`), paint("1", `+++ b/${displayName}`)];
  const split = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));
  let offset = 0;
  for (const hunk of hunks) {
    const start = lineStarts[hunk.first] ?? 0;
    const next = lineStarts[hunk.last + 1];
    const end = next === undefined ? source.length - (source.endsWith("\n") ? 1 : 0) : next - 1;
    const before = split(source.slice(start, end));
    const shifted = hunk.edits.map((edit) => ({
      ...edit,
      start: edit.start - start,
      end: edit.end - start,
    }));
    const after = split(applyEdits(source.slice(start, end), shifted));
    out.push(
      paint(
        "36",
        `@@ -${hunk.first + 1},${before.length} +${hunk.first + 1 + offset},${after.length} @@`,
      ),
    );
    for (const [sign, line] of diffLines(before, after)) {
      out.push(sign === " " ? ` ${line}` : paint(sign === "-" ? "31" : "32", `${sign}${line}`));
    }
    offset += after.length - before.length;
  }
  return `${out.join("\n")}\n`;
}

/** Line diff of a hunk (longest common subsequence; hunks are a few lines long). */
function diffLines(
  before: readonly string[],
  after: readonly string[],
): [" " | "-" | "+", string][] {
  // common[i][j]: length of the LCS of before[i..] and after[j..].
  const common = before.map(() => new Array<number>(after.length + 1).fill(0));
  common.push(new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      const row = common[i]!;
      row[j] =
        before[i] === after[j]
          ? common[i + 1]![j + 1]! + 1
          : Math.max(common[i + 1]![j]!, row[j + 1]!);
    }
  }
  const lines: [" " | "-" | "+", string][] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      lines.push([" ", before[i++]!]);
      j++;
    } else if (
      j < after.length &&
      (i === before.length || common[i]![j + 1]! >= common[i + 1]![j]!)
    ) {
      lines.push(["+", after[j++]!]);
    } else {
      lines.push(["-", before[i++]!]);
    }
  }
  // Show removals before additions within each changed block, as diff tools do.
  for (let start = 0; start < lines.length; start++) {
    if (lines[start]![0] === " ") continue;
    let end = start;
    while (end < lines.length && lines[end]![0] !== " ") end++;
    const block = lines.slice(start, end);
    lines.splice(
      start,
      block.length,
      ...block.filter(([sign]) => sign === "-"),
      ...block.filter(([sign]) => sign === "+"),
    );
    start = end;
  }
  return lines;
}

export function toJson(files: readonly FileReport[]): JsonFinding[] {
  const findings: JsonFinding[] = [];
  for (const { displayName, result } of files) {
    const entries = [
      ...result.changes.map((finding) => ({ finding, kind: "change" as const })),
      ...result.manual.map((finding) => ({ finding, kind: "manual" as const })),
    ].sort((a, b) => a.finding.line - b.finding.line || a.finding.column - b.finding.column);
    for (const { finding, kind } of entries) {
      findings.push({
        file: displayName,
        line: finding.line,
        column: finding.column,
        kind,
        message: finding.message,
        anchor: finding.anchor,
      });
    }
  }
  return findings;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The human-readable report: per file the diff (dry run only) and findings, then a summary. */
export function formatReport(files: readonly FileReport[], options: ReportOptions): string {
  const paint = painter(options.color);
  const sections: string[] = [];
  let changedFiles = 0;
  let changeCount = 0;
  let manualFiles = 0;
  let manualCount = 0;

  for (const { displayName, source, result } of files) {
    const { changes, manual, edits } = result;
    if (changes.length === 0 && manual.length === 0) continue;
    if (edits.length > 0) changedFiles++;
    if (manual.length > 0) manualFiles++;
    changeCount += changes.length;
    manualCount += manual.length;

    const lines = [paint("1", displayName)];
    if (!options.write && edits.length > 0)
      lines.push(formatDiff(displayName, source, edits, options.color));
    const rows = [
      ...changes.map((finding) => ({ finding, manual: false })),
      ...manual.map((finding) => ({ finding, manual: true })),
    ].sort((a, b) => a.finding.line - b.finding.line || a.finding.column - b.finding.column);
    const width = Math.max(...rows.map(({ finding }) => location(finding).length));
    for (const { finding, manual: isManual } of rows) {
      const where = location(finding).padEnd(width);
      const label = isManual ? paint("33", "manual ") : paint("32", "changed");
      const anchor = isManual ? paint("2", `  ${finding.anchor}`) : "";
      lines.push(`  ${where}  ${label}  ${finding.message}${anchor}`);
    }
    sections.push(lines.join("\n"));
  }

  const summary: string[] = [];
  const scanned = `scanned ${plural(options.scanned, "file")}`;
  if (changeCount === 0 && manualCount === 0) {
    summary.push(`Nothing to migrate (${scanned}).`);
  } else {
    const changed =
      changeCount === 0
        ? "No automatic changes"
        : `${options.write ? "Changed" : "Would change"} ${plural(changedFiles, "file")} (${plural(changeCount, "change")})`;
    const toFix =
      manualCount === 0
        ? "nothing needs a manual fix"
        : `${plural(manualCount, "item")} in ${plural(manualFiles, "file")} ${manualCount === 1 ? "needs" : "need"} a manual fix`;
    summary.push(`${changed}; ${toFix} (${scanned}).`);
    if (!options.write && changeCount > 0) {
      summary.push("Dry run: nothing was written. Re-run with --write to apply the changes.");
    }
  }
  summary.push(
    "Next: go through the checklist in MIGRATION.md (node_modules/meteor-rpc/MIGRATION.md); manual items link to its sections.",
  );
  sections.push(paint("1", summary.join("\n")));
  return `${sections.join("\n\n")}\n`;
}

function location(finding: Finding): string {
  return `${finding.line}:${finding.column}`;
}
