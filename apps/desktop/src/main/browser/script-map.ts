import { TraceMap, originalPositionFor, type SourceMapInput } from '@jridgewell/trace-mapping';

/** Source maps larger than this are ignored. */
const MAP_LIMIT = 1_500_000;

/**
 * A generated bundle. Dev stacks that name a `.tsx` or `.vue` file are not this: their line
 * numbers belong to transformed code and are not mapped.
 */
export function isGeneratedScript(file: string): boolean {
  if (!/^https?:\/\//i.test(file)) return false;
  try {
    return /\.(?:mjs|cjs|js)$/.test(new URL(file).pathname);
  } catch {
    return false;
  }
}

/** The `sourceMappingURL` comment at the end of a script, if it has one. */
export function sourceMappingUrl(source: string): string | null {
  const lines = source.split(/\r?\n/);
  const start = Math.max(0, lines.length - 5);
  for (let index = lines.length - 1; index >= start; index--) {
    const line = lines[index]?.trim().replace(/\*\/\s*$/, '') ?? '';
    const match = /[@#]\s*sourceMappingURL=(\S+)/.exec(line);
    if (match?.[1]) return match[1];
  }
  return null;
}

/** Resolves a mapping comment against the script that carried it. */
export function resolveMappingUrl(scriptUrl: string, mapping: string): string | null {
  if (mapping.startsWith('data:')) return mapping;
  try {
    return new URL(mapping, scriptUrl).href;
  } catch {
    return null;
  }
}

/** A map may be inlined, or fetched from the same host as the script. */
export function allowedMapUrl(scriptUrl: string, mapUrl: string): boolean {
  if (mapUrl.startsWith('data:')) return true;
  let script: URL;
  let map: URL;
  try {
    script = new URL(scriptUrl);
    map = new URL(mapUrl);
  } catch {
    return false;
  }
  if (map.protocol !== 'http:' && map.protocol !== 'https:') return false;
  return map.host === script.host;
}

/** Decodes a `data:` source map. Anything else returns null. */
export function decodeDataUrl(url: string): string | null {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) return null;
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) return Buffer.from(data, 'base64').toString('utf8');
    return decodeURIComponent(data);
  } catch {
    return null;
  }
}

export async function fetchSourceMap(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return null;
  const text = await response.text();
  return text.length > MAP_LIMIT ? null : text;
}

/**
 * The original file for a generated position. Stack columns are 1-based; the result column is
 * 1-based too. `source` is resolved against `mapUrl` (a `data:` map has no base, so relative
 * sources stay relative).
 */
export function originalFromMap(
  mapJson: string,
  mapUrl: string,
  line: number,
  column: number,
): { source: string; line: number; column: number } | null {
  let map: TraceMap;
  try {
    map = new TraceMap(JSON.parse(mapJson) as SourceMapInput, mapUrl.startsWith('data:') ? null : mapUrl);
  } catch {
    return null;
  }
  const position = originalPositionFor(map, { line, column: Math.max(0, column - 1) });
  if (!position.source) return null;
  const index = map.sources.indexOf(position.source);
  const resolved = index >= 0 ? map.resolvedSources[index] : null;
  return {
    source: resolved || position.source,
    line: position.line,
    column: position.column + 1,
  };
}
