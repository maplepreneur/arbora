import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolveSource } from '../agent-mode/source-paths.js';
import { patchTailwindSource, type WriteThroughEdit } from '@arbora/shared';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export interface PreparedWrite {
  readonly path: string;
  readonly relative: string;
  readonly text: string;
}

/**
 * Patches every file in memory. Nothing is written until `commitWriteThrough`, so a refusal or a
 * failed screenshot leaves the project untouched.
 */
export function prepareWriteThrough(projectPath: string, edits: readonly WriteThroughEdit[]): PreparedWrite[] {
  const byFile = new Map<
    string,
    { relative: string; edits: { line: number; classes: WriteThroughEdit['classes'] }[] }
  >();
  for (const edit of edits) {
    const resolved = resolveSource({ file: edit.file, line: edit.line, column: null }, projectPath, isFile);
    if (!resolved?.line) throw new Error('Could not find that element in the project.');
    const bucket = byFile.get(resolved.path) ?? { relative: resolved.relative, edits: [] };
    bucket.edits.push({ line: resolved.line, classes: edit.classes });
    byFile.set(resolved.path, bucket);
  }
  const ready: PreparedWrite[] = [];
  for (const [path, file] of byFile) {
    const patched = patchTailwindSource(readFileSync(path, 'utf8'), file.relative, file.edits);
    if (!patched.ok) throw new Error(`${file.relative}: ${patched.reason}`);
    ready.push({ path, relative: file.relative, text: patched.text });
  }
  return ready;
}

export function commitWriteThrough(files: readonly PreparedWrite[]): void {
  for (const file of files) writeFileSync(file.path, file.text, 'utf8');
}
