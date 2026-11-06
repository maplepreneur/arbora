import { describe, expect, it } from 'vitest';
import {
  nextWorktreePort,
  packageInstallCommand,
  portOfDevUrl,
  worktreeBranchForAgent,
  worktreeBranchName,
  worktreeDevCommand,
  worktreeDevPlan,
  worktreeDevUrl,
  worktreeDirectory,
} from './worktree.js';

describe('worktree names', () => {
  it('slugs a task title into a branch and a sibling directory', () => {
    expect(worktreeBranchName('Fix the nav!')).toBe('fix-the-nav');
    expect(worktreeDirectory('/code/app', 'fix-the-nav')).toBe('/code/app-fix-the-nav');
  });

  it('uses grove-session when the title has no letters or digits', () => {
    expect(worktreeBranchName('   !!! ')).toBe('grove-session');
  });

  it('gives each agent in a best-of-N set its own branch', () => {
    expect(worktreeBranchForAgent('Fix the nav', 'claude')).toBe('fix-the-nav-claude');
    expect(worktreeBranchForAgent('Fix the nav', 'Claude Code')).toBe('fix-the-nav-claude-code');
  });
});

describe('worktree dev server', () => {
  it('reads an explicit port and ignores a URL without one', () => {
    expect(portOfDevUrl('http://127.0.0.1:5173/')).toBe(5173);
    expect(portOfDevUrl('http://localhost/')).toBeNull();
    expect(portOfDevUrl('not a url')).toBeNull();
  });

  it('skips ports another worktree already has', () => {
    expect(nextWorktreePort(5174, [5174, 5175])).toBe(5176);
  });

  it('points the browser at the parent URL with the new port', () => {
    expect(worktreeDevUrl('http://localhost:5173/app/', 5174)).toBe('http://localhost:5174/app/');
    expect(worktreeDevUrl(undefined, 5174)).toBe('http://127.0.0.1:5174/');
  });

  it('forwards --port through a package script and pins other commands directly', () => {
    expect(worktreeDevCommand('pnpm dev', 5174)).toBe('pnpm dev -- --port 5174');
    expect(worktreeDevCommand('npm run dev', 5174)).toBe('npm run dev -- --port 5174');
    expect(worktreeDevCommand('npm start', 5174)).toBe('npm start -- --port 5174');
    expect(worktreeDevCommand('yarn dev', 5174)).toBe('yarn dev -- --port 5174');
    expect(worktreeDevCommand('bun run dev', 5174)).toBe('bun run dev -- --port 5174');
    expect(worktreeDevCommand('vite', 5174)).toBe('vite --port 5174');
    expect(worktreeDevCommand('next dev', 5174)).toBe('next dev --port 5174');
    expect(worktreeDevCommand('bin/rails server', 5174)).toBe('bin/rails server -p 5174');
    expect(worktreeDevCommand('pnpm dev -- --port 3000', 5174)).toBe('pnpm dev -- --port 5174');
    expect(worktreeDevCommand('bin/rails server -p 3000', 5174)).toBe('bin/rails server -p 5174');
  });

  it('plans the next free port from the parent dev URL and command', () => {
    expect(
      worktreeDevPlan({
        parentDevUrl: 'http://127.0.0.1:5173/',
        parentCommand: 'pnpm dev',
        takenPorts: [5174],
      }),
    ).toEqual({
      port: 5175,
      devUrl: 'http://127.0.0.1:5175/',
      devCommand: 'pnpm dev -- --port 5175',
    });
    expect(worktreeDevPlan({ parentCommand: null, takenPorts: [] })).toEqual({
      port: 5174,
      devUrl: 'http://127.0.0.1:5174/',
      devCommand: null,
    });
  });

  it('names an install command for each package manager', () => {
    expect(packageInstallCommand('pnpm')).toBe('pnpm install');
    expect(packageInstallCommand('npm')).toBe('npm install');
    expect(packageInstallCommand('yarn')).toBe('yarn install');
    expect(packageInstallCommand('bun')).toBe('bun install');
  });
});
