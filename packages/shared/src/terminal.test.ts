import { describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  detectShell,
  findDevUrls,
  inferDevCommand,
  LineBuffer,
  ScrollbackBuffer,
  shellCommandArgs,
  stripAnsi,
  terminalClipboardAction,
  type ClipboardKey,
} from './terminal.js';

describe('terminalClipboardAction', () => {
  const key = (code: string, mods: Partial<Omit<ClipboardKey, 'code'>> = {}): ClipboardKey => ({
    code,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    ...mods,
  });

  it('copies with Ctrl+C only when text is selected, so Ctrl+C still interrupts', () => {
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'linux', true)).toBe('copy');
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'linux', false)).toBeNull();
    expect(terminalClipboardAction(key('KeyC', { ctrl: true, shift: true }), 'linux', false)).toBe('copy');
    expect(terminalClipboardAction(key('Insert', { ctrl: true }), 'win32', true)).toBe('copy');
  });

  it('pastes with Ctrl+V, Ctrl+Shift+V and Shift+Insert (Omarchy sends Ctrl+V for Super+V)', () => {
    expect(terminalClipboardAction(key('KeyV', { ctrl: true }), 'linux', false)).toBe('paste');
    expect(terminalClipboardAction(key('KeyV', { ctrl: true, shift: true }), 'linux', false)).toBe('paste');
    expect(terminalClipboardAction(key('Insert', { shift: true }), 'linux', false)).toBe('paste');
    expect(terminalClipboardAction(key('KeyV', { ctrl: true, alt: true }), 'linux', false)).toBeNull();
  });

  it('uses Cmd on macOS and leaves Ctrl chords to the shell', () => {
    expect(terminalClipboardAction(key('KeyC', { meta: true }), 'darwin', false)).toBe('copy');
    expect(terminalClipboardAction(key('KeyV', { meta: true }), 'darwin', false)).toBe('paste');
    expect(terminalClipboardAction(key('KeyC', { ctrl: true }), 'darwin', true)).toBeNull();
    expect(terminalClipboardAction(key('KeyV', { ctrl: true }), 'darwin', false)).toBeNull();
  });
});

describe('stripAnsi', () => {
  it('removes colours, cursor moves, OSC titles and stray controls', () => {
    expect(stripAnsi('\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:')).toBe('➜  Local:');
    expect(stripAnsi('\u001b]0;user@host: ~\u0007$ ls')).toBe('$ ls');
    expect(stripAnsi('\u001b[?25l\u001b[2K\u001b[1Gdone\u0008')).toBe('done');
    expect(stripAnsi('a\tb\r\n')).toBe('a\tb\r\n');
  });
});

describe('findDevUrls', () => {
  it('finds the URL in Vite output with ANSI codes inside it', () => {
    const vite =
      '  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m';
    expect(findDevUrls(stripAnsi(vite))).toEqual(['http://localhost:5173/']);
  });

  it('handles Next, Nuxt and plain server banners', () => {
    expect(findDevUrls('   - Local:        http://localhost:3000')).toEqual(['http://localhost:3000/']);
    expect(findDevUrls('  ➜ Local:    http://localhost:3000/')).toEqual(['http://localhost:3000/']);
    expect(findDevUrls('plain-html fixture: http://localhost:5500/')).toEqual(['http://localhost:5500/']);
    expect(findDevUrls('Listening on http://127.0.0.1:8080/app?x=1.')).toEqual(['http://127.0.0.1:8080/app?x=1']);
  });

  it('normalises wildcard hosts and accepts .local and IPv6 loopback', () => {
    expect(findDevUrls('on http://0.0.0.0:4000')).toEqual(['http://localhost:4000/']);
    expect(findDevUrls('(http://[::1]:5173/)')).toEqual(['http://[::1]:5173/']);
    expect(findDevUrls('https://my-mac.local:8443/')).toEqual(['https://my-mac.local:8443/']);
  });

  it('ignores remote and LAN addresses and dedupes', () => {
    expect(findDevUrls('  ➜  Network: http://192.168.1.20:5173/')).toEqual([]);
    expect(findDevUrls('see https://vite.dev/guide and https://localhost.example.com')).toEqual([]);
    expect(findDevUrls('http://localhost:5173 http://localhost:5173')).toEqual(['http://localhost:5173/']);
  });
});

describe('LineBuffer', () => {
  it('splits chunks into lines across boundaries and keeps a pending line', () => {
    const buffer = new LineBuffer(10);
    expect(buffer.push('hel')).toEqual([]);
    expect(buffer.push('lo\r\nwor')).toEqual(['hello']);
    expect(buffer.pending).toBe('wor');
    expect(buffer.tail()).toEqual(['hello', 'wor']);
  });

  it('applies carriage-return overwrites and caps the line count', () => {
    const buffer = new LineBuffer(2);
    buffer.push('10%\r50%\r100%\n\u001b[31ma\u001b[0m\nb\nc\n');
    expect(buffer.tail()).toEqual(['b', 'c']);
    const progress = new LineBuffer(5);
    progress.push('10%\r50%\r100%\n');
    expect(progress.tail()).toEqual(['100%']);
    buffer.clear();
    expect(buffer.tail()).toEqual([]);
  });
});

describe('ScrollbackBuffer', () => {
  it('keeps the most recent characters', () => {
    const buffer = new ScrollbackBuffer(5);
    buffer.push('abc');
    buffer.push('def');
    expect(buffer.toString()).toBe('def');
    buffer.push('ghijklmn');
    expect(buffer.toString()).toBe('jklmn');
  });
});

describe('detectShell', () => {
  const exists = (paths: string[]) => (path: string) => paths.includes(path);

  it('uses $SHELL on Linux and a login shell on macOS', () => {
    expect(detectShell('linux', { SHELL: '/usr/bin/fish' }, exists(['/usr/bin/fish']))).toEqual({
      file: '/usr/bin/fish',
      args: [],
    });
    expect(detectShell('darwin', { SHELL: '/bin/zsh' }, exists(['/bin/zsh']))).toEqual({
      file: '/bin/zsh',
      args: ['-l'],
    });
  });

  it('falls back when $SHELL is missing or does not exist, and honours an override', () => {
    expect(detectShell('linux', { SHELL: '/nope' }, exists(['/bin/bash'])).file).toBe('/bin/bash');
    expect(detectShell('darwin', {}, exists(['/bin/zsh'])).file).toBe('/bin/zsh');
    expect(detectShell('linux', {}, exists([])).file).toBe('/bin/sh');
    expect(
      detectShell('linux', { SHELL: '/bin/bash' }, exists(['/bin/bash', '/usr/bin/zsh']), '/usr/bin/zsh').file,
    ).toBe('/usr/bin/zsh');
  });

  it('prefers pwsh, then Windows PowerShell, then cmd on Windows', () => {
    const env = { PATH: 'C:\\Program Files\\PowerShell\\7\\;C:\\Windows\\system32', SystemRoot: 'C:\\Windows' };
    const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const winps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    expect(detectShell('win32', env, exists([pwsh, winps]))).toEqual({ file: pwsh, args: ['-NoLogo'] });
    expect(detectShell('win32', env, exists([winps]))).toEqual({ file: winps, args: ['-NoLogo'] });
    expect(detectShell('win32', { ...env, ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, exists([]))).toEqual({
      file: 'C:\\Windows\\system32\\cmd.exe',
      args: [],
    });
  });
});

describe('shellCommandArgs', () => {
  it('builds one-shot command arguments per shell', () => {
    expect(shellCommandArgs('linux', '/bin/bash', 'pnpm dev')).toEqual(['-c', 'pnpm dev']);
    expect(shellCommandArgs('darwin', '/bin/zsh', 'pnpm dev')).toEqual(['-lc', 'pnpm dev']);
    expect(shellCommandArgs('win32', 'C:\\x\\pwsh.exe', 'pnpm dev')).toEqual([
      '-NoLogo',
      '-Command',
      '$global:LASTEXITCODE = 0; pnpm dev; if ($LASTEXITCODE) { exit $LASTEXITCODE }',
    ]);
    expect(shellCommandArgs('win32', 'C:\\Windows\\system32\\cmd.exe', 'pnpm dev')).toEqual([
      '/d',
      '/s',
      '/c',
      'pnpm dev',
    ]);
  });
});

describe('inferDevCommand', () => {
  it('picks dev, then start, then serve, with the package manager from the lockfile', () => {
    expect(inferDevCommand({ scripts: { dev: 'vite', start: 'x' }, lockfiles: ['pnpm-lock.yaml'] })).toBe('pnpm dev');
    expect(inferDevCommand({ scripts: { start: 'next start' }, lockfiles: ['package-lock.json'] })).toBe('npm start');
    expect(inferDevCommand({ scripts: { serve: 'x' }, lockfiles: [] })).toBe('npm run serve');
    expect(inferDevCommand({ scripts: { dev: 'x' }, lockfiles: ['yarn.lock'] })).toBe('yarn dev');
    expect(inferDevCommand({ scripts: { dev: 'x' }, lockfiles: ['bun.lockb'] })).toBe('bun run dev');
    expect(inferDevCommand({ scripts: { build: 'x' }, lockfiles: [] })).toBeNull();
    expect(inferDevCommand({ scripts: undefined, lockfiles: [] })).toBeNull();
  });

  it('prefers the packageManager field over lockfiles', () => {
    expect(detectPackageManager({ packageManagerField: 'pnpm@10.33.4', lockfiles: ['package-lock.json'] })).toBe(
      'pnpm',
    );
    expect(detectPackageManager({ packageManagerField: 'weird@1', lockfiles: ['yarn.lock'] })).toBe('yarn');
  });
});
