import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { detectStyling, type StylingApproach } from '@arbora/shared';

const SKIP = new Set([
  'node_modules',
  '.git',
  '.arbora',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.vite',
  '.vercel',
  '.cache',
  'dist',
  'build',
  'out',
  'coverage',
]);

const INTERESTING = /\.(css|scss|sass|json|js|cjs|mjs|ts)$/;

/**
 * Tailwind, CSS modules, styled-components, Emotion or plain CSS, from the project's files.
 * Walks a few levels and skips dependency and build directories.
 */
export function detectProjectStyling(root: string): {
  approach: StylingApproach;
  colors: Map<string, string>;
  note: string;
} {
  const paths: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) continue;
      const abs = join(dir, name);
      let info;
      try {
        info = statSync(abs);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!info.isFile() || info.size > 1_000_000 || !INTERESTING.test(name)) continue;
      paths.push(abs.slice(root.length + 1).replaceAll('\\', '/'));
    }
  };
  walk(root, 0);
  let packageJson: string | null = null;
  try {
    packageJson = readFileSync(join(root, 'package.json'), 'utf8');
  } catch {
    // A folder with no package.json is plain CSS unless a Tailwind file was found above.
  }
  return detectStyling({
    packageJson,
    paths,
    read: (relativePath) => {
      try {
        return readFileSync(join(root, relativePath), 'utf8');
      } catch {
        return null;
      }
    },
  });
}
