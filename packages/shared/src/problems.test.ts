import { describe, expect, it } from 'vitest';
import type { ProblemEntry } from './browser.js';
import type { Diagnostic } from './files.js';
import { fixDiagnosticsPrompt, fixPageProblemsPrompt } from './problems.js';

const failed = (id: number): ProblemEntry => ({
  id,
  source: 'network',
  level: 'error',
  message: '502 Bad Gateway',
  timestamp: id,
  url: 'http://localhost:5173/api/v1/auth/login',
  method: 'POST',
  status: 502,
});

describe('fixPageProblemsPrompt', () => {
  it('lists a repeated failure once with a count, and names the page', () => {
    const prompt = fixPageProblemsPrompt([failed(1), failed(2), failed(3)], 'http://localhost:5173/login');
    expect(prompt).toContain('Fix this problem from the browser at http://localhost:5173/login:');
    expect(prompt).toContain('- [error, network] POST 502 Bad Gateway (http://localhost:5173/api/v1/auth/login) ×3');
    expect(prompt.match(/POST 502/g)).toHaveLength(1);
  });

  it('names the method of a failed request, and the location of a console error', () => {
    const { status: _status, ...refused } = failed(1);
    const prompt = fixPageProblemsPrompt(
      [
        { ...refused, message: 'net::ERR_CONNECTION_REFUSED' },
        {
          id: 2,
          source: 'exception',
          level: 'error',
          message: 'TypeError: x is undefined',
          timestamp: 2,
          url: 'http://localhost:5173/src/App.tsx',
          line: 12,
          column: 4,
        },
      ],
      null,
    );
    expect(prompt).toContain('Fix these problems from the browser:');
    expect(prompt).toContain('POST net::ERR_CONNECTION_REFUSED');
    expect(prompt).toContain('TypeError: x is undefined (http://localhost:5173/src/App.tsx:12:4)');
  });
});

describe('fixDiagnosticsPrompt', () => {
  const diagnostic = (line: number): Diagnostic => ({
    path: 'src/App.tsx',
    line,
    column: 3,
    severity: 'error',
    message: "Type 'string' is not assignable to type 'number'.",
    source: 'tsc',
    code: 'TS2322',
  });

  it('lists each diagnostic with its location and rule', () => {
    const prompt = fixDiagnosticsPrompt([diagnostic(4)]);
    expect(prompt).toContain('Fix this problem');
    expect(prompt).toContain("- src/App.tsx:4:3 [error, tsc TS2322] Type 'string' is not assignable");
  });

  it('caps a long list', () => {
    const prompt = fixDiagnosticsPrompt(Array.from({ length: 60 }, (_, i) => diagnostic(i + 1)));
    expect(prompt).toContain('…and 10 more of the same kind');
    expect(prompt).not.toContain('src/App.tsx:51:3');
  });
});
