/**
 * Planning the inspector's "Install dev plugin" action. The desktop app copies `@arbora/dev-plugin`
 * into the project and applies these edits; nothing here touches the disk.
 */

export const DEV_PLUGIN_PACKAGE = '@arbora/dev-plugin';
export const DEV_PLUGIN_SPEC = 'file:.arbora/dev-plugin';

export type DevPluginBundler = 'vite' | 'next' | 'nuxt';

export type ConfigPatch = { status: 'unchanged' } | { status: 'patched'; source: string } | { status: 'unsupported' };

const VITE_CONFIGS = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
] as const;
const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.mts',
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
] as const;
const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.mts', 'nuxt.config.js', 'nuxt.config.mjs'] as const;

export function devPluginConfigNames(kind: DevPluginBundler): readonly string[] {
  switch (kind) {
    case 'vite':
      return VITE_CONFIGS;
    case 'next':
      return NEXT_CONFIGS;
    case 'nuxt':
      return NUXT_CONFIGS;
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

/** Nuxt before Next before Vite: a Nuxt app also depends on Vite. */
export function detectDevPluginBundler(pkg: {
  readonly dependencies?: Readonly<Record<string, string>> | undefined;
  readonly devDependencies?: Readonly<Record<string, string>> | undefined;
}): DevPluginBundler | null {
  const names = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  if (names.has('nuxt')) return 'nuxt';
  if (names.has('next')) return 'next';
  if (names.has('vite')) return 'vite';
  return null;
}

export function devPluginConfigured(source: string, kind: DevPluginBundler): boolean {
  switch (kind) {
    case 'vite':
      return source.includes('arboraDevPlugin') || source.includes(DEV_PLUGIN_PACKAGE);
    case 'next':
      return source.includes('withArbora') || source.includes(`${DEV_PLUGIN_PACKAGE}/next`);
    case 'nuxt':
      return source.includes(`${DEV_PLUGIN_PACKAGE}/nuxt`);
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

/** Inserts the file: dependency without reformatting the rest of `package.json`. */
export function addDevPluginDependency(
  packageJson: string,
  spec: string = DEV_PLUGIN_SPEC,
): { source: string; changed: boolean } {
  const key = `"${DEV_PLUGIN_PACKAGE}"`;
  if (packageJson.includes(key)) return { source: packageJson, changed: false };
  const line = `    ${key}: ${JSON.stringify(spec)}`;
  const match = /"devDependencies"\s*:\s*\{/.exec(packageJson);
  if (match) {
    const at = match.index + match[0].length;
    const rest = packageJson.slice(at);
    const insertion = /^\s*\}/.test(rest) ? `\n${line}\n  ` : `\n${line},`;
    return { source: packageJson.slice(0, at) + insertion + rest, changed: true };
  }
  const end = packageJson.lastIndexOf('}');
  if (end === -1) throw new Error('package.json is not an object');
  const inside = packageJson.slice(packageJson.indexOf('{') + 1, end);
  const comma = inside.trim() === '' ? '' : ',';
  const insertion = `${comma}\n  "devDependencies": {\n${line}\n  }\n`;
  return { source: packageJson.slice(0, end) + insertion + packageJson.slice(end), changed: true };
}

export function patchDevPluginConfig(source: string, kind: DevPluginBundler): ConfigPatch {
  switch (kind) {
    case 'vite':
      return patchViteConfig(source);
    case 'next':
      return patchNextConfig(source);
    case 'nuxt':
      return patchNuxtConfig(source);
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

export function freshDevPluginConfig(kind: DevPluginBundler): { name: string; source: string } {
  switch (kind) {
    case 'vite':
      return {
        name: 'vite.config.ts',
        source: `import { defineConfig } from 'vite';\nimport { arboraDevPlugin } from '@arbora/dev-plugin';\n\nexport default defineConfig({\n  plugins: [arboraDevPlugin()],\n});\n`,
      };
    case 'next':
      return {
        name: 'next.config.ts',
        source: `import { withArbora } from '@arbora/dev-plugin/next';\n\nconst nextConfig = {};\n\nexport default withArbora(nextConfig);\n`,
      };
    case 'nuxt':
      return {
        name: 'nuxt.config.ts',
        source: `export default defineNuxtConfig({\n  modules: ['@arbora/dev-plugin/nuxt'],\n});\n`,
      };
    default: {
      const neverKind: never = kind;
      return neverKind;
    }
  }
}

function patchViteConfig(source: string): ConfigPatch {
  if (devPluginConfigured(source, 'vite')) return { status: 'unchanged' };
  const imported = insertImport(source, "import { arboraDevPlugin } from '@arbora/dev-plugin';");
  const plugins = /plugins\s*:\s*\[/.exec(imported);
  if (plugins) {
    const at = plugins.index + plugins[0].length;
    const next = imported.slice(at).trimStart();
    const insertion = next.startsWith(']') ? 'arboraDevPlugin()' : 'arboraDevPlugin(), ';
    return { status: 'patched', source: imported.slice(0, at) + insertion + imported.slice(at) };
  }
  const object = /(?:defineConfig|export default)\s*(?:\(\s*)?\{/.exec(imported);
  if (!object) return { status: 'unsupported' };
  const at = object.index + object[0].length;
  return {
    status: 'patched',
    source: `${imported.slice(0, at)}\n  plugins: [arboraDevPlugin()],${imported.slice(at)}`,
  };
}

function patchNextConfig(source: string): ConfigPatch {
  if (devPluginConfigured(source, 'next')) return { status: 'unchanged' };
  const imported = insertImport(source, "import { withArbora } from '@arbora/dev-plugin/next';");
  const named = /export default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(imported);
  if (named?.[1] && named[1] !== 'withArbora') {
    return { status: 'patched', source: imported.replace(named[0], `export default withArbora(${named[1]});`) };
  }
  const cjs = /module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/.exec(imported);
  if (cjs?.[1]) {
    return { status: 'patched', source: imported.replace(cjs[0], `module.exports = withArbora(${cjs[1]});`) };
  }
  const objectExport = /export default\s*\{/.exec(imported);
  if (!objectExport) return { status: 'unsupported' };
  const brace = imported.indexOf('{', objectExport.index);
  const end = matchBrace(imported, brace);
  if (brace === -1 || end === -1) return { status: 'unsupported' };
  const wrapped = `${imported.slice(0, objectExport.index)}export default withArbora(${imported.slice(brace, end + 1)})${imported.slice(end + 1)}`;
  return { status: 'patched', source: wrapped };
}

function patchNuxtConfig(source: string): ConfigPatch {
  if (devPluginConfigured(source, 'nuxt')) return { status: 'unchanged' };
  const modules = /modules\s*:\s*\[/.exec(source);
  if (modules) {
    const at = modules.index + modules[0].length;
    const next = source.slice(at).trimStart();
    const insertion = next.startsWith(']') ? "'@arbora/dev-plugin/nuxt'" : "'@arbora/dev-plugin/nuxt', ";
    return { status: 'patched', source: source.slice(0, at) + insertion + source.slice(at) };
  }
  const object = /defineNuxtConfig\s*\(\s*\{/.exec(source);
  if (!object) return { status: 'unsupported' };
  const at = object.index + object[0].length;
  return {
    status: 'patched',
    source: `${source.slice(0, at)}\n  modules: ['@arbora/dev-plugin/nuxt'],${source.slice(at)}`,
  };
}

function insertImport(source: string, statement: string): string {
  const lines = source.split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^\s*import\s/.test(line) || /^\s*export\s+.*\sfrom\s/.test(line)) last = i;
    else if (last >= 0 && line.trim() !== '' && !line.trim().startsWith('//')) break;
  }
  if (last === -1) return `${statement}\n${source}`;
  lines.splice(last + 1, 0, statement);
  return lines.join('\n');
}

function matchBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
