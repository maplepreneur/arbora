import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSetupScript, setupCommandText, setupTerminalLaunch } from './setup-launch';

describe('findSetupScript', () => {
  it('walks up to scripts/setup-1password.sh', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbora-setup-'));
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts', 'setup-1password.sh');
    writeFileSync(script, '#!/bin/sh\n');
    expect(findSetupScript([join(root, 'apps', 'desktop', 'out', 'main')], 'linux')).toBe(script);
  });

  it('returns null when the checkout is not above the start', () => {
    const root = mkdtempSync(join(tmpdir(), 'arbora-setup-miss-'));
    expect(findSetupScript([root], 'linux')).toBeNull();
  });
});

describe('setupTerminalLaunch', () => {
  it('quotes a path and prefers the Debian terminal alternative', () => {
    const script = "/tmp/owner's checkout/scripts/setup-1password.sh";
    const launch = setupTerminalLaunch('linux', script, (name) =>
      name === 'gnome-terminal' || name === 'x-terminal-emulator' ? `/usr/bin/${name}` : undefined,
    );
    expect(launch?.command).toBe('/usr/bin/x-terminal-emulator');
    expect(launch?.args.join(' ')).toContain(`sh '/tmp/owner'\\''s checkout/scripts/setup-1password.sh' --yes`);
  });

  it('returns null when Linux has no known terminal', () => {
    expect(setupTerminalLaunch('linux', '/tmp/setup-1password.sh', () => undefined)).toBeNull();
  });

  it('opens Terminal on macOS and a window on Windows', () => {
    const mac = setupTerminalLaunch('darwin', '/tmp/setup-1password.sh', () => undefined);
    expect(mac?.command).toBe('osascript');
    expect(mac?.args.join(' ')).toContain('setup-1password.sh');
    const win = setupTerminalLaunch('win32', 'C:\\src\\setup-1password.ps1', () => undefined);
    expect(win?.args).toContain('C:\\src\\setup-1password.ps1');
  });
});

describe('setupCommandText', () => {
  it('falls back to the package script when the file is not in the tree', () => {
    expect(setupCommandText('linux', null)).toBe('pnpm setup:1password --yes');
  });
});
