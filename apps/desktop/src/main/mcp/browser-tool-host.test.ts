import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeImage } from 'electron';
import type { BrowserService } from '../browser/browser-service.js';
import type { BrowserTabs } from '../browser/browser-tabs.js';
import { TabGrantStore } from '../browser/tab-grants.js';
import { ArboraToolHost } from './browser-tool-host.js';

const decoded: string[] = [];

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer(buffer: Buffer): NativeImage {
      decoded.push(buffer.toString('utf8'));
      const image = {
        isEmpty: () => false,
        getSize: () => ({ width: 4, height: 4 }),
        resize: () => image,
        toPNG: () => Buffer.from('png'),
        toJPEG: () => Buffer.from(`jpeg:${decoded.at(-1) ?? ''}`),
      };
      return image as unknown as NativeImage;
    },
  },
}));

function page(id: string): BrowserService {
  return {
    getState: () => ({ url: `https://example.test/${id}` }),
    screenshot: () => Promise.resolve({ pngBase64: Buffer.from(id).toString('base64'), width: 4, height: 4, dpr: 1 }),
  } as unknown as BrowserService;
}

describe('ArboraToolHost trace thumbnails', () => {
  const active = page('active');
  const hidden = page('figma');
  const grants = new TabGrantStore();
  const seen: { image: string | null }[] = [];

  beforeEach(() => {
    decoded.length = 0;
    seen.length = 0;
  });

  function host(): ArboraToolHost {
    grants.grant('/tmp/proj', 'thread-1', 'figma');
    return new ArboraToolHost({
      projectPath: '/tmp/proj',
      browser: () => active,
      devServer: () => null,
      terminals: () => null,
      projectSettings: () => ({ version: 1 }),
      saveToolPolicy: () => undefined,
      findCandidates: () => Promise.resolve([]),
      askPermission: () => Promise.resolve('once'),
      preview: () => undefined,
      trace: (step) => {
        seen.push({ image: step.image?.data ?? null });
      },
      threadId: 'thread-1',
      tabs: () =>
        ({
          projectPath: '/tmp/proj',
          resolve: (target: string | undefined) =>
            Promise.resolve(
              target === 'figma'
                ? { id: 'figma', role: 'reference' as const, service: hidden }
                : { id: 'app', role: 'app' as const, service: active },
            ),
        }) as unknown as BrowserTabs,
      grants,
    });
  }

  it('thumbnails the tab the tool resolved, not the visible one', async () => {
    const toolHost = host();
    await toolHost.resolveTarget('figma', 'read');
    await toolHost.recordTrace({ tool: 'browser_click', title: 'Click', ok: true, error: null });
    expect(decoded).toEqual(['figma']);
    expect(seen[0]?.image).toBe(Buffer.from('jpeg:figma').toString('base64'));
  });
});
