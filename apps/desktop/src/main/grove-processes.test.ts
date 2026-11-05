import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  adoptionOf,
  keepRunningAfterLastWindow,
  groveProcessLedgerPath,
  readProcessLedger,
  writeProcessLedger,
  type RecordedProcess,
} from './grove-processes.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sample: RecordedProcess = {
  projectPath: '/code/app',
  kind: 'terminal',
  id: 't1',
  pid: 42,
  cwd: '/code/app',
  command: 'pnpm run dev',
  title: 'npm:dev',
};

describe('grove process ledger', () => {
  it('round-trips pid, cwd and command, and treats a bad file as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbora-ledger-'));
    dirs.push(dir);
    const file = groveProcessLedgerPath(dir);
    expect(readProcessLedger(file).processes).toEqual([]);
    writeProcessLedger(file, [sample]);
    expect(readProcessLedger(file).processes).toEqual([sample]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, processes: [sample] });
    writeProcessLedger(file, []);
    expect(readProcessLedger(join(dir, 'missing.json')).processes).toEqual([]);
  });

  it('keeps a live Grove process up only for an interactive quit', () => {
    expect(keepRunningAfterLastWindow(true, true)).toBe(true);
    expect(keepRunningAfterLastWindow(true, false)).toBe(false);
    expect(keepRunningAfterLastWindow(false, true)).toBe(false);
  });

  it('adopts a living process and marks a dead or reused pid gone', () => {
    expect(adoptionOf(sample, { alive: true, cwd: '/code/app' })).toBe('running');
    expect(adoptionOf(sample, { alive: true, cwd: null })).toBe('running');
    expect(adoptionOf(sample, { alive: false, cwd: null })).toBe('gone');
    expect(adoptionOf(sample, { alive: true, cwd: '/other' })).toBe('gone');
  });
});
