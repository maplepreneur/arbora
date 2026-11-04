import type { ProblemEntry } from './browser.js';
import type { Diagnostic } from './files.js';

const MAX_PROBLEMS = 50;

function pageProblemLine(problem: ProblemEntry): string {
  const where = problem.url
    ? ` (${problem.url}${problem.line !== undefined ? `:${problem.line}${problem.column !== undefined ? `:${problem.column}` : ''}` : ''})`
    : '';
  const message =
    problem.source === 'network' && problem.method ? `${problem.method} ${problem.message}` : problem.message;
  return `- [${problem.level}, ${problem.source}] ${message}${where}`;
}

function diagnosticLine(diagnostic: Diagnostic): string {
  const code = diagnostic.code ? ` ${diagnostic.code}` : '';
  return `- ${diagnostic.path}:${diagnostic.line}:${diagnostic.column} [${diagnostic.severity}, ${diagnostic.source}${code}] ${diagnostic.message}`;
}

function listed<T>(items: readonly T[], line: (item: T) => string): string {
  const shown = items.slice(0, MAX_PROBLEMS).map(line);
  if (items.length > MAX_PROBLEMS) shown.push(`- …and ${items.length - MAX_PROBLEMS} more of the same kind`);
  return shown.join('\n');
}

/**
 * The prompt behind "Fix" / "Fix all" for the page's console errors and failed requests. Repeated
 * entries (the same failing request every few seconds) are listed once with a count.
 */
export function fixPageProblemsPrompt(problems: readonly ProblemEntry[], pageUrl: string | null): string {
  const counts = new Map<string, { problem: ProblemEntry; count: number }>();
  for (const problem of problems) {
    const key = pageProblemLine(problem);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { problem, count: 1 });
  }
  const unique = [...counts.values()];
  const one = unique.length === 1;
  return [
    `Fix ${one ? 'this problem' : 'these problems'} from the browser${pageUrl ? ` at ${pageUrl}` : ''}:`,
    '',
    listed(unique, ({ problem, count }) => `${pageProblemLine(problem)}${count > 1 ? ` ×${count}` : ''}`),
    '',
    'Find the cause in this project and fix it. If a failing request comes from a server or service that is not running, say what to start instead of changing code.',
  ].join('\n');
}

/** The prompt behind "Fix" / "Fix all" for ESLint and TypeScript diagnostics. */
export function fixDiagnosticsPrompt(diagnostics: readonly Diagnostic[]): string {
  const one = diagnostics.length === 1;
  return [
    `Fix ${one ? 'this problem' : 'these problems'} reported by the project's checks:`,
    '',
    listed(diagnostics, diagnosticLine),
    '',
    'Fix the code rather than silencing the rule or the type error, unless the check itself is wrong.',
  ].join('\n');
}
