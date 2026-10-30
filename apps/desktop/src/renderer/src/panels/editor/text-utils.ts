import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { Text } from '@codemirror/state';
import type { Diagnostic } from '@arbora/shared';

export function textOf(content: string): Text {
  return Text.of(content.split(/\r\n?|\n/));
}

/** The smallest single change turning `from` into `to` (keeps the cursor where text is unchanged). */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) {
    endFrom--;
    endTo--;
  }
  return { from: start, to: endFrom, insert: to.slice(start, endTo) };
}

/** Converts 1-based line/column diagnostics to CodeMirror offsets in `doc`, clamped to the text. */
export function toCmDiagnostics(doc: Text, diagnostics: readonly Diagnostic[]): CmDiagnostic[] {
  const offset = (line: number, column: number): number => {
    const l = doc.line(Math.min(Math.max(1, line), doc.lines));
    return Math.min(l.from + Math.max(0, column - 1), l.to);
  };
  return diagnostics.map((d) => {
    const from = offset(d.line, d.column);
    const end = d.endLine !== undefined ? offset(d.endLine, d.endColumn ?? d.column) : from;
    return {
      from,
      to: Math.max(from, end),
      severity: d.severity,
      message: d.message,
      source: d.code ? `${d.source} (${d.code})` : d.source,
    };
  });
}
