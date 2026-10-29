import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowserHistory, MAX_HISTORY_ENTRIES } from './browser-history.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arbora-history-'));
  file = join(dir, 'nested', 'history.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('BrowserHistory', () => {
  it('keeps one entry per URL, newest first, and persists on flush', () => {
    const history = new BrowserHistory(file);
    history.record('http://localhost:5173/', 'Home', 1);
    history.record('http://localhost:5173/about', '', 2);
    history.record('http://localhost:5173/', '', 3);
    history.setTitle('http://localhost:5173/about', 'About');
    expect(history.list()).toEqual([
      { url: 'http://localhost:5173/', title: 'Home', visitedAt: 3 },
      { url: 'http://localhost:5173/about', title: 'About', visitedAt: 2 },
    ]);
    history.flush();
    expect(new BrowserHistory(file).list()).toEqual(history.list());
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveProperty('entries');
  });

  it('ignores non-http URLs and caps the list', () => {
    const history = new BrowserHistory(file);
    history.record('about:blank', '');
    history.record('devtools://devtools/x', '');
    for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) history.record(`http://localhost/${i}`, '', i);
    expect(history.list()).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(history.list()[0]?.url).toBe(`http://localhost/${MAX_HISTORY_ENTRIES + 4}`);
    history.dispose();
  });

  it('starts empty when the file is corrupt', () => {
    writeFileSync(join(dir, 'bad.json'), '{not json');
    expect(new BrowserHistory(join(dir, 'bad.json')).list()).toEqual([]);
  });
});
