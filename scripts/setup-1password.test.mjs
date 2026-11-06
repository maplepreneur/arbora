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
    expect(result.out).toContain('account: fail');
    expect(result.out).toContain('desktop: fail');
    expect(result.out).toContain('extension:');
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

describe('setup-1password --yes and --uninstall', () => {
  it('does not write the browser allow-list or install packages without a terminal', async () => {
    const result = await run(['--yes'], '/usr/bin:/bin');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Not writing that file');
    expect(result.out).toContain('did not install packages');
    expect(result.out).toContain('https://downloads.1password.com/linux/debian/');
    expect(result.out).toContain('1password-cli');
    expect(result.out).toContain('account: fail');
    expect(result.out).toContain('Integrate with 1Password CLI');
    expect(result.out).not.toMatch(/\[sudo\]|password for/);
  });

  it('prints how to uninstall and removes nothing', async () => {
    const result = await run(['--uninstall'], '/usr/bin:/bin');
    expect(result.code).toBe(0);
    expect(result.out).toContain('not removed by surprise');
    expect(result.out).not.toMatch(/sudo /);
  });
});
