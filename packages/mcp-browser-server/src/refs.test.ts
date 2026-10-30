import { describe, expect, it } from 'vitest';
import { ToolError } from './cdp.js';
import { RefTable, resolveElement } from './refs.js';
import { FakeCdp } from './testing.js';

function liveNodes(ids: number[]): FakeCdp {
  return new FakeCdp({
    'DOM.describeNode': (params) => {
      const id = params['backendNodeId'] ?? (params['nodeId'] === 42 ? 7 : undefined);
      if (typeof id !== 'number' || !ids.includes(id)) throw new Error('No node with given id found');
      return { node: { backendNodeId: id } };
    },
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelector': (params) => {
      if (params['selector'] === '!!') throw new Error('DOM Error while querying');
      return { nodeId: params['selector'] === 'button.primary' ? 42 : 0 };
    },
  });
}

describe('resolveElement', () => {
  it('maps a snapshot ref to its backend node and checks that it is still in the page', async () => {
    const refs = new RefTable();
    refs.replace(new Map([['e3', 7]]));
    const cdp = liveNodes([7]);
    await expect(resolveElement(cdp, refs, { ref: 'e3' })).resolves.toBe(7);
    await expect(resolveElement(cdp, refs, { ref: 'ref=e3' })).resolves.toBe(7);
    expect(cdp.calls[0]).toEqual({ method: 'DOM.describeNode', params: { backendNodeId: 7 } });
  });

  it('explains stale and unknown refs', async () => {
    const refs = new RefTable();
    await expect(resolveElement(liveNodes([]), refs, { ref: 'e1' })).rejects.toThrow(/call browser_snapshot first/);
    refs.replace(new Map([['e1', 5]]));
    await expect(resolveElement(liveNodes([]), refs, { ref: 'e9' })).rejects.toThrow(/Unknown ref e9/);
    await expect(resolveElement(liveNodes([]), refs, { ref: 'e1' })).rejects.toThrow(/no longer in the page/);
  });

  it('resolves CSS selectors through DOM.querySelector', async () => {
    const refs = new RefTable();
    const cdp = liveNodes([7]);
    await expect(resolveElement(cdp, refs, { selector: 'button.primary' })).resolves.toBe(7);
    expect(cdp.methods()).toEqual(['DOM.getDocument', 'DOM.querySelector', 'DOM.describeNode']);
    await expect(resolveElement(cdp, refs, { selector: '.missing' })).rejects.toThrow(/No element matches/);
    await expect(resolveElement(cdp, refs, { selector: '!!' })).rejects.toBeInstanceOf(ToolError);
  });

  it('needs a ref or a selector', async () => {
    await expect(resolveElement(liveNodes([]), new RefTable(), {})).rejects.toThrow(/ref .* or a CSS selector/);
  });
});
