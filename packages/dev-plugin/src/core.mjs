import { isAbsolute, relative, sep } from 'node:path';

/** Host elements only. Fragments and components never receive this: it would not reach the DOM. */
export const ARBORA_SRC_ATTRIBUTE = 'data-arbora-src';

const HTML_TAGS = new Set(
  `a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg path g circle rect line polyline polygon ellipse text tspan defs use symbol clippath mask image lineargradient radialgradient stop filter`.split(
    ' ',
  ),
);

/**
 * Inserts `data-arbora-src="file:line:column"` on host elements. `file` is the project-relative
 * path the caller chooses. JSX components, fragments and TypeScript generics are left alone.
 * A `.vue` file is transformed only inside its `<template>`.
 *
 * @param {string} code
 * @param {string} file
 */
export function injectArboraSrc(code, file) {
  const normalized = file.replaceAll('\\', '/').replace(/[?#].*$/, '');
  if (normalized.endsWith('.vue') && /<template(\s|>)/.test(code)) return injectVueSfc(code, normalized);
  if (normalized.endsWith('.vue')) return injectMarkup(code, normalized, 0, code);
  return injectMarkup(code, normalized, 0, code);
}

/**
 * Vite plugin. Development server only (`apply: 'serve'`).
 *
 * @param {{ root?: string }} [options]
 */
export function arboraDevPlugin(options = {}) {
  let root = options.root ?? '';
  let dev = true;
  return {
    name: 'arbora-dev-plugin',
    apply: 'serve',
    enforce: 'pre',
    /** @param {{ root: string, command: string }} config */
    configResolved(config) {
      root = config.root || root;
      dev = config.command !== 'build';
    },
    /**
     * @param {string} code
     * @param {string} id
     */
    transform(code, id) {
      if (!dev || id.includes('\0') || id.includes('node_modules')) return null;
      if (/[?&]type=/.test(id) && !/[?&]type=template/.test(id)) return null;
      const clean = cleanId(id);
      if (!clean || !/\.(jsx|tsx|vue|js|ts|mjs|cjs)$/.test(clean)) return null;
      const rel = toRelative(root, clean);
      const next = injectArboraSrc(code, rel);
      if (next === code) return null;
      return { code: next, map: null };
    },
  };
}

/**
 * Wraps a Next config so the webpack loader runs in `next dev` only.
 *
 * @param {unknown} [nextConfig]
 */
export function withArbora(nextConfig = {}) {
  /** @param {string} _phase @param {unknown} _defaults */
  return function arboraNextConfig(_phase, _defaults) {
    const resolved = typeof nextConfig === 'function' ? nextConfig(_phase, _defaults) : nextConfig;
    const config =
      resolved && typeof resolved === 'object' ? { .../** @type {Record<string, unknown>} */ (resolved) } : {};
    const previous = config['webpack'];
    config['webpack'] = (
      /** @type {Record<string, unknown>} */ webpackConfig,
      /** @type {{ dev?: boolean }} */ options,
    ) => {
      const next =
        typeof previous === 'function'
          ? /** @type {(config: Record<string, unknown>, options: { dev?: boolean }) => Record<string, unknown>} */ (
              previous
            )(webpackConfig, options)
          : webpackConfig;
      if (options?.dev) {
        const module = /** @type {{ rules?: unknown[] }} */ (next['module'] ?? {});
        module.rules = module.rules ?? [];
        module.rules.push({
          test: /\.[cm]?[jt]sx?$/,
          exclude: /node_modules/,
          enforce: 'pre',
          loader: '@arbora/dev-plugin/webpack',
        });
        next['module'] = module;
      }
      return next;
    };
    return config;
  };
}

/**
 * @param {string} code
 * @param {string} file
 */
function injectVueSfc(code, file) {
  const open = /<template(\s[^>]*)?>/.exec(code);
  if (!open) return code;
  const start = open.index + open[0].length;
  let depth = 1;
  let cursor = start;
  while (cursor < code.length && depth > 0) {
    const nextOpen = code.indexOf('<template', cursor);
    const nextClose = code.indexOf('</template>', cursor);
    if (nextClose === -1) return code;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + '<template'.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      const inner = injectMarkup(code.slice(start, nextClose), file, start, code);
      return code.slice(0, start) + inner + code.slice(nextClose);
    }
    cursor = nextClose + '</template>'.length;
  }
  return code;
}

/**
 * @param {string} code The slice to rewrite.
 * @param {string} file
 * @param {number} offset Index of `code[0]` in `full`, for line numbers.
 * @param {string} full
 */
function injectMarkup(code, file, offset, full) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const next = end === -1 ? code.length : end + 3;
      out += code.slice(i, next);
      i = next;
      continue;
    }
    if (code.startsWith('//', i)) {
      const end = code.indexOf('\n', i);
      const next = end === -1 ? code.length : end;
      out += code.slice(i, next);
      i = next;
      continue;
    }
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      const next = end === -1 ? code.length : end + 2;
      out += code.slice(i, next);
      i = next;
      continue;
    }
    const quote = code[i];
    if (quote === '"' || quote === "'" || quote === '`') {
      const next = skipString(code, i);
      out += code.slice(i, next);
      i = next;
      continue;
    }
    if (quote === '<' && !precededByIdentifier(code, i)) {
      const tag = readTagName(code, i);
      if (tag) {
        const end = openingTagEnd(code, tag.after);
        if (end !== -1 && !code.slice(i, end + 1).includes(ARBORA_SRC_ATTRIBUTE)) {
          const { line, column } = lineCol(full, offset + i);
          const attr = ` ${ARBORA_SRC_ATTRIBUTE}="${escapeAttr(file)}:${line}:${column}"`;
          const selfClosing = code[end - 1] === '/';
          let insertAt = selfClosing ? end - 1 : end;
          if (selfClosing) {
            while (insertAt > tag.after && /\s/.test(code[insertAt - 1] ?? '')) insertAt -= 1;
          }
          const closer = selfClosing ? ' />' : '>';
          out += code.slice(i, insertAt) + attr + closer;
          i = end + 1;
          if (tag.name === 'script' || tag.name === 'style') {
            const close = code.toLowerCase().indexOf(`</${tag.name}`, i);
            const next = close === -1 ? code.length : close;
            out += code.slice(i, next);
            i = next;
          }
          continue;
        }
      }
    }
    out += code[i] ?? '';
    i += 1;
  }
  return out;
}

/**
 * @param {string} code
 * @param {number} index Index of `<`.
 * @returns {{ name: string, after: number } | null}
 */
function readTagName(code, index) {
  let j = index + 1;
  const first = code[j];
  if (first === '/' || first === '>' || first === '!' || first === undefined) return null;
  if (!/[a-z]/.test(first)) return null;
  const start = j;
  while (j < code.length && /[A-Za-z0-9-]/.test(code[j] ?? '')) j += 1;
  const name = code.slice(start, j);
  if (!HTML_TAGS.has(name.toLowerCase())) return null;
  const next = code[j];
  if (next !== undefined && next !== '>' && next !== '/' && !/\s/.test(next)) return null;
  return { name: name.toLowerCase(), after: j };
}

/** Index of the opening tag's `>`, or -1 when `<` is a comparison or a generic. */
function openingTagEnd(code, after) {
  let j = after;
  let brace = 0;
  while (j < code.length) {
    const c = code[j];
    if (c === '"' || c === "'" || c === '`') {
      j = skipString(code, j);
      continue;
    }
    if (c === '{') {
      brace += 1;
      j += 1;
      continue;
    }
    if (c === '}') {
      brace = Math.max(0, brace - 1);
      j += 1;
      continue;
    }
    if (brace === 0 && c === '&' && code[j + 1] === '&') return -1;
    if (brace === 0 && c === '|' && code[j + 1] === '|') return -1;
    if (brace === 0 && c === ';') return -1;
    if (c === '>' && brace === 0) return j;
    j += 1;
  }
  return -1;
}

/** @param {string} code @param {number} index */
function precededByIdentifier(code, index) {
  if (index === 0) return false;
  return /[\w$.]/.test(code[index - 1] ?? '');
}

/** @param {string} code @param {number} index Index of the opening quote. */
function skipString(code, index) {
  const quote = code[index];
  let j = index + 1;
  while (j < code.length) {
    const c = code[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (quote === '`' && c === '$' && code[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < code.length && depth > 0) {
        if (code[j] === '{') depth += 1;
        else if (code[j] === '}') depth -= 1;
        j += 1;
      }
      continue;
    }
    j += 1;
  }
  return code.length;
}

/** @param {string} code @param {number} index */
function lineCol(code, index) {
  let line = 1;
  let column = 1;
  const stop = Math.min(index, code.length);
  for (let i = 0; i < stop; i += 1) {
    if (code.charCodeAt(i) === 10) {
      line += 1;
      column = 1;
    } else column += 1;
  }
  return { line, column };
}

/** @param {string} file */
function escapeAttr(file) {
  return file.replaceAll('"', '').replaceAll('\n', '').replaceAll('<', '');
}

/** @param {string} id */
function cleanId(id) {
  const noQuery = id.split('?')[0] ?? id;
  const fs = /^\/@fs(\/.*)$/.exec(noQuery);
  if (fs?.[1]) return fs[1];
  return noQuery;
}

/** @param {string} root @param {string} file */
function toRelative(root, file) {
  const normalized = file.replaceAll('\\', '/');
  if (!root || !isAbsolute(file)) return normalized;
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) return normalized;
  return rel.split(sep).join('/');
}
