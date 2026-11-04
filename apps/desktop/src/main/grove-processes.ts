import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export const recordedProcessSchema = z.object({
  projectPath: z.string().min(1),
  kind: z.enum(['terminal', 'agent']),
  id: z.string().min(1),
  pid: z.number().int().positive(),
  cwd: z.string().min(1),
  command: z.string(),
  title: z.string(),
});
export type RecordedProcess = z.infer<typeof recordedProcessSchema>;

const ledgerSchema = z.object({
  version: z.literal(1),
  processes: z.array(recordedProcessSchema).max(500),
});
export type ProcessLedger = z.infer<typeof ledgerSchema>;

export const EMPTY_LEDGER: ProcessLedger = { version: 1, processes: [] };

export function groveProcessLedgerPath(userData: string): string {
  return join(userData, 'grove-processes.json');
}

/** A missing or unreadable file is an empty ledger. The file never contains secrets. */
export function readProcessLedger(file: string): ProcessLedger {
  try {
    const parsed = ledgerSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : EMPTY_LEDGER;
  } catch {
    return EMPTY_LEDGER;
  }
}

export function writeProcessLedger(file: string, processes: readonly RecordedProcess[]): void {
  const body = JSON.stringify({ version: 1, processes: [...processes] } satisfies ProcessLedger);
  writeFileSync(file, body);
}

/**
 * A recorded pid is still the process we started when it is alive and, where the OS can say,
 * its working directory is the one we recorded. A reused pid with a different directory is gone.
 */
/**
 * A live Grove process keeps the app up after the last window closes, so the user can quit from
 * the tray. The end-to-end harness is not interactive: it has to be able to exit.
 */
export function keepRunningAfterLastWindow(live: boolean, interactive: boolean): boolean {
  return live && interactive;
}

export function adoptionOf(
  record: Pick<RecordedProcess, 'cwd'>,
  probe: { alive: boolean; cwd: string | null },
): 'running' | 'gone' {
  if (!probe.alive) return 'gone';
  if (probe.cwd !== null && probe.cwd !== record.cwd) return 'gone';
  return 'running';
}
