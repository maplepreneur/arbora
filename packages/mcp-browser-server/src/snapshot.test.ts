import { describe, expect, it } from 'vitest';
import { formatSnapshot, type AxNode } from './snapshot.js';

function node(
  nodeId: string,
  role: string,
  name: string,
  childIds: string[] = [],
  extra: Partial<AxNode> = {},
): AxNode {
  return { nodeId, role: { value: role }, name: { value: name }, childIds, ...extra };
}

/** A page like the vite-react fixture: heading, wrapper divs, a card with a button. */
const PAGE: AxNode[] = [
  node('1', 'RootWebArea', 'Arbora fixture', ['2'], { backendDOMNodeId: 1 }),
  node('2', 'generic', '', ['3', '5', '6'], { backendDOMNodeId: 2, parentId: '1' }),
  node('3', 'heading', 'Arbora fixture', ['4'], {
    backendDOMNodeId: 3,
    parentId: '2',
    properties: [{ name: 'level', value: { value: 1 } }],
  }),
  node('4', 'StaticText', 'Arbora fixture', ['4a'], { parentId: '3' }),
  node('4a', 'InlineTextBox', 'Arbora fixture', [], { parentId: '4' }),
  node('5', 'paragraph', '', ['5a'], { backendDOMNodeId: 5, parentId: '2' }),
  node('5a', 'StaticText', 'Clicked 0 times', [], { parentId: '5' }),
  node('6', 'generic', '', ['7', '9'], { backendDOMNodeId: 6, parentId: '2' }),
  node('7', 'button', 'Increment', ['8'], { backendDOMNodeId: 7, parentId: '6' }),
  node('8', 'StaticText', 'Increment', [], { parentId: '7' }),
  node('9', 'textbox', 'Email', [], {
    backendDOMNodeId: 9,
    parentId: '6',
    value: { value: 'a@b.c' },
    properties: [
      { name: 'required', value: { value: true } },
      { name: 'disabled', value: { value: false } },
    ],
  }),
  node('10', 'none', '', [], { ignored: true, parentId: '6' }),
];

describe('formatSnapshot', () => {
  it('prints Playwright-style lines with refs and hoists unnamed wrappers', () => {
    const snapshot = formatSnapshot(PAGE);
    expect(snapshot.text).toBe(
      [
        '- heading "Arbora fixture" [level=1] [ref=e1]',
        '- paragraph [ref=e2]:',
        '  - text: "Clicked 0 times"',
        '- button "Increment" [ref=e3]',
        '- textbox "Email" [value="a@b.c"] [required] [ref=e4]',
      ].join('\n'),
    );
    expect(snapshot.refs.get('e3')).toBe(7);
    expect(snapshot.refs.get('e4')).toBe(9);
    expect(snapshot.truncated).toBe(false);
  });

  it('keeps named groups and nests their children', () => {
    const nodes = [
      node('1', 'RootWebArea', 'Page', ['2']),
      node('2', 'navigation', 'Main', ['3'], { backendDOMNodeId: 2, parentId: '1' }),
      node('3', 'link', 'Home', [], {
        backendDOMNodeId: 3,
        parentId: '2',
        properties: [{ name: 'url', value: { value: 'http://localhost/' } }],
      }),
    ];
    expect(formatSnapshot(nodes).text).toBe(
      ['- navigation "Main" [ref=e1]:', '  - link "Home" [url=http://localhost/] [ref=e2]'].join('\n'),
    );
  });

  it('caps the output and says so', () => {
    const children = Array.from({ length: 50 }, (_, i) =>
      node(`c${i}`, 'button', `B${i}`, [], { backendDOMNodeId: 100 + i, parentId: 'root' }),
    );
    const nodes = [
      node(
        'root',
        'RootWebArea',
        'Page',
        children.map((c) => c.nodeId),
      ),
      ...children,
    ];
    const snapshot = formatSnapshot(nodes, { maxNodes: 10, maxDepth: 60, maxText: 200 });
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.text.split('\n')).toHaveLength(11);
    expect(snapshot.text).toMatch(/Snapshot truncated/);
    expect(snapshot.refs.size).toBe(10);
  });

  it('joins adjacent text nodes, as React renders `Hello, {name}` in pieces', () => {
    const nodes = [
      node('1', 'RootWebArea', 'Page', ['2']),
      node('2', 'paragraph', '', ['3', '4', '5', '6'], { backendDOMNodeId: 2, parentId: '1' }),
      node('3', 'StaticText', 'Hello, ', [], { parentId: '2' }),
      node('4', 'StaticText', 'Ada', [], { parentId: '2' }),
      node('5', 'link', 'more', [], { backendDOMNodeId: 5, parentId: '2' }),
      node('6', 'StaticText', ' (large)', [], { parentId: '2' }),
    ];
    expect(formatSnapshot(nodes).text).toBe(
      ['- paragraph [ref=e1]:', '  - text: "Hello, Ada"', '  - link "more" [ref=e2]', '  - text: "(large)"'].join('\n'),
    );
  });

  it('shortens long names', () => {
    const nodes = [node('1', 'RootWebArea', '', ['2']), node('2', 'button', 'x'.repeat(500), [], { parentId: '1' })];
    const line = formatSnapshot(nodes, { maxNodes: 100, maxDepth: 10, maxText: 20 }).text;
    expect(line).toBe(`- button "${'x'.repeat(19)}…"`);
  });
});
