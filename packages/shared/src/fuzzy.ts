/**
 * fzf-style fuzzy matching for quick open. The query's characters must appear in order
 * (case-insensitive, spaces ignored). Matches score higher at word boundaries (after `/`, `-`, `_`,
 * `.`, or a lower-to-upper case change), in runs of consecutive characters, and inside the file name.
 */

const SCORE_MATCH = 16;
const BONUS_SLASH = 24;
const BONUS_BOUNDARY = 16;
const BONUS_CAMEL = 12;
const BONUS_CONSECUTIVE = 12;
const BONUS_BASENAME = 8;
const BONUS_FIRST_CHAR = 8;
const PENALTY_GAP_START = 3;
const PENALTY_GAP = 1;

export interface FuzzyResult {
  readonly path: string;
  readonly score: number;
  /** Indices into `path` of the matched characters. */
  readonly positions: readonly number[];
}

function normaliseQuery(query: string): string {
  return query.replace(/\s+/g, '').toLowerCase();
}

function boundaryBonus(path: string, index: number): number {
  if (index === 0) return BONUS_BOUNDARY;
  const previous = path.charCodeAt(index - 1);
  if (previous === 47 /* / */ || previous === 92 /* \ */) return BONUS_SLASH;
  if (previous === 45 /* - */ || previous === 95 /* _ */ || previous === 46 /* . */ || previous === 32) {
    return BONUS_BOUNDARY;
  }
  const current = path.charCodeAt(index);
  const previousLower = previous >= 97 && previous <= 122;
  const currentUpper = current >= 65 && current <= 90;
  return previousLower && currentUpper ? BONUS_CAMEL : 0;
}

/** Fast check that every query character appears in order. */
function isSubsequence(query: string, lowerPath: string): boolean {
  let at = 0;
  for (let i = 0; i < query.length; i++) {
    at = lowerPath.indexOf(query.charAt(i), at);
    if (at === -1) return false;
    at++;
  }
  return true;
}

/**
 * Best score for `query` (already normalised) against `path`, with the matched positions when
 * `withPositions` is set. Smith-Waterman style: `best[j]` is the best score with the current query
 * character matched at `j`.
 */
function scoreAligned(
  query: string,
  path: string,
  withPositions: boolean,
): { score: number; positions: number[] } | null {
  const lower = path.toLowerCase();
  if (!isSubsequence(query, lower)) return null;
  const n = path.length;
  const m = query.length;
  const basenameStart = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1;
  const bonus = new Float64Array(n);
  for (let j = 0; j < n; j++) bonus[j] = boundaryBonus(path, j) + (j >= basenameStart ? BONUS_BASENAME : 0);

  const NONE = -Infinity;
  let previous = new Float64Array(n).fill(NONE);
  const back: Int32Array[] = [];
  for (let i = 0; i < m; i++) {
    const current = new Float64Array(n).fill(NONE);
    const from = withPositions ? new Int32Array(n).fill(-1) : null;
    const ch = query.charAt(i);
    // Best score of the previous row at any index < j, minus the gap penalty since that index.
    let bestBefore = NONE;
    let bestBeforeIndex = -1;
    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) {
        const candidate = previous[j - 1] ?? NONE;
        const decayed = bestBefore === NONE ? NONE : bestBefore - PENALTY_GAP;
        if (candidate !== NONE && candidate - PENALTY_GAP_START >= decayed) {
          bestBefore = candidate - PENALTY_GAP_START;
          bestBeforeIndex = j - 1;
        } else {
          bestBefore = decayed;
        }
      }
      if (lower.charAt(j) !== ch) continue;
      const own = SCORE_MATCH + (bonus[j] ?? 0);
      if (i === 0) {
        current[j] = own + (j === 0 ? BONUS_FIRST_CHAR : 0) - Math.min(j, 12) * 0.25;
        continue;
      }
      const diagonal = j > 0 ? (previous[j - 1] ?? NONE) : NONE;
      let score = NONE;
      if (diagonal !== NONE) {
        score = diagonal + own + BONUS_CONSECUTIVE;
        if (from) from[j] = j - 1;
      }
      if (bestBefore !== NONE && bestBefore + own > score) {
        score = bestBefore + own;
        if (from) from[j] = bestBeforeIndex;
      }
      current[j] = score;
    }
    previous = current;
    if (from) back.push(from);
  }

  let score = NONE;
  let end = -1;
  for (let j = 0; j < n; j++) {
    const value = previous[j] ?? NONE;
    if (value > score) {
      score = value;
      end = j;
    }
  }
  if (score === NONE) return null;
  // Shorter paths win ties.
  score -= n * 0.01;
  const positions: number[] = [];
  if (withPositions) {
    let j = end;
    for (let i = m - 1; i >= 0 && j >= 0; i--) {
      positions.unshift(j);
      j = i > 0 ? (back[i]?.[j] ?? -1) : -1;
    }
  }
  return { score, positions };
}

/** Score of one path, or null when it does not match. An empty query matches everything with 0. */
export function fuzzyScore(query: string, path: string): FuzzyResult | null {
  const normalised = normaliseQuery(query);
  if (normalised.length === 0) return { path, score: 0, positions: [] };
  const result = scoreAligned(normalised, path, true);
  return result ? { path, score: result.score, positions: result.positions } : null;
}

/**
 * The best `limit` matches, best first. Positions are only computed for the returned ones. An empty
 * query returns the first `limit` paths in their given order (callers pass recent files first).
 */
export function fuzzyFilter(query: string, paths: readonly string[], limit = 50): FuzzyResult[] {
  const normalised = normaliseQuery(query);
  if (normalised.length === 0) return paths.slice(0, limit).map((path) => ({ path, score: 0, positions: [] }));
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const result = scoreAligned(normalised, path, false);
    if (result) scored.push({ path, score: result.score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map(({ path }) => {
    const result = scoreAligned(normalised, path, true);
    return { path, score: result?.score ?? 0, positions: result?.positions ?? [] };
  });
}
