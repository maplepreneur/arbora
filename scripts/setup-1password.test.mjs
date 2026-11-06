import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = join(import.meta.dirname, 'setup-1password.sh');

function run(args, path) {
  return exec('sh', [script, ...args], { env: { PATH: path }, timeout: 10_000 }).then(
    (result) => ({ code: 0, out: result.stdout }),
    (error) => ({
      code: typeof error.code === 'number' ? error.code : 1,
      out: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    }),
  );
}

describe('setup-1password --check', () => {
  it('reports a missing op without installing or using sudo', async () => {
    const result = await run(['--check'], '/usr/bin:/bin');
    expect(result.code).toBe(1);
    expect(result.out).toContain('op: not installed');
    expect(result.out).toContain('does not install');
    expect(result.out).not.toMatch(/sudo /);
  });

  it('reports the version when op is on PATH', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arbora-op-'));
    const bin = join(dir, 'op');
    writeFileSync(bin, '#!/bin/sh\necho 2.32.0-fixture\n');
    chmodSync(bin, 0o755);
    const result = await run(['--check'], `${dir}:/usr/bin:/bin`);
    expect(result.code).toBe(0);
    expect(result.out).toContain('op: 2.32.0-fixture');
    expect(result.out).not.toMatch(/sudo /);
  });
});
