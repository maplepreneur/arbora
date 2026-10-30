export type LanguageId =
  | 'javascript'
  | 'jsx'
  | 'typescript'
  | 'tsx'
  | 'html'
  | 'css'
  | 'json'
  | 'markdown'
  | 'python'
  | 'go'
  | 'rust'
  | 'vue'
  | 'svelte';

const BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  vue: 'vue',
  svelte: 'svelte',
};

const BY_NAME: Readonly<Record<string, LanguageId>> = {
  '.babelrc': 'json',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
};

/** The highlighting language for a file, by extension (or a few well-known names). */
export function languageIdForPath(path: string): LanguageId | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 && !name.startsWith('.')) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}
