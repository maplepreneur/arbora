import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentModeSelection, ContentBlock, InspectorSelection } from '@arbora/shared';
import type { AgentService } from '../agent/agent-service.js';
import type { BrowserService } from '../browser/browser-service.js';
import { AgentModeService } from './agent-mode-service.js';

vi.mock('electron', () => ({ nativeImage: {} }));

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'arbora-agent-mode-'));
  mkdirSync(join(root, 'src/components'), { recursive: true });
  writeFileSync(join(root, 'src/components/Button.tsx'), 'export function Button() {}');
  writeFileSync(join(root, 'src/components/Card.tsx'), 'export function Card() {}');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function rawSelection(): InspectorSelection {
  return {
    url: 'http://localhost:5173/',
    title: 'Fixture',
    ref: '1',
    selector: '#go',
    framework: { id: 'react', react: true, vue: false, reactVersion: '18.3.1' },
    components: [
      {
        name: 'Button',
        minified: false,
        server: false,
        definedAt: { file: join(root, 'src/components/Button.tsx'), line: 5, column: 5 },
        renderedAt: { file: 'http://localhost:5173/src/components/Card.tsx?t=1', line: 19, column: 9 },
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
      {
        name: 'Card',
        minified: false,
        server: false,
        definedAt: { file: join(root, 'src/components/Gone.tsx'), line: 1, column: 1 },
        renderedAt: null,
        rect: null,
      },
    ],
    targetIndex: 0,
    element: {
      tag: 'button',
      id: 'go',
      classes: ['btn'],
      uniqueClasses: ['btn'],
      text: 'Go',
      html: '<button id="go">Go</button>',
      styles: {},
      rect: { x: 10, y: 20, width: 100, height: 40 },
    },
    viewport: { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 },
    notes: [],
  };
}

function setup(options: { image?: boolean } = {}) {
  const browser = {
    setInspecting: vi.fn(),
    setOverlayVisible: vi.fn(() => Promise.resolve()),
    screenshot: vi.fn(() => Promise.resolve({ pngBase64: 'iVBOR', width: 800, height: 600, dpr: 1 })),
    consoleErrorsSinceNavigation: vi.fn(() => ['boom']),
    writeScreenshotFile: vi.fn(),
  };
  const prompts: { threadId: string; blocks: ContentBlock[]; title: string | undefined }[] = [];
  let resolvePrompted: () => void = () => undefined;
  const prompted = new Promise<void>((resolve) => {
    resolvePrompted = resolve;
  });
  const agents = {
    createThread: vi.fn(() => ({ id: 'new-thread' })),
    promptCapabilities: vi.fn(() =>
      Promise.resolve({ image: options.image ?? false, loadSession: false, resume: false, embeddedContext: false }),
    ),
    prompt: vi.fn((threadId: string, blocks: ContentBlock[], _attachments: unknown, opts: { title?: string }) => {
      prompts.push({ threadId, blocks, title: opts.title });
      resolvePrompted();
      return Promise.resolve({ stopReason: 'end_turn' });
    }),
  };
  const events = { picked: vi.fn(), selected: vi.fn<(s: AgentModeSelection) => void>(), ended: vi.fn() };
  const findCandidates = vi.fn(() =>
    Promise.resolve([{ path: join(root, 'src/x.tsx'), relative: 'src/x.tsx', matched: ['Button'] }]),
  );
  const service = new AgentModeService({
    projectPath: root,
    browser: () => browser as unknown as BrowserService,
    agents: () => agents as unknown as AgentService,
    findCandidates,
    events,
  });
  return { service, browser, agents, events, prompts, prompted, findCandidates };
}

describe('AgentModeService', () => {
  it('forwards inspecting to the page and ignores selections while inactive', async () => {
    const { service, browser, events } = setup();
    await service.select(rawSelection());
    expect(events.picked).not.toHaveBeenCalled();
    service.setInspecting(true);
    expect(browser.setInspecting).toHaveBeenLastCalledWith(true);
    service.setInspecting(false);
    expect(browser.setInspecting).toHaveBeenLastCalledWith(false);
  });

  it('resolves sources, captures without the overlay and reports the selection', async () => {
    const { service, browser, events, findCandidates } = setup();
    service.setInspecting(true);
    await service.select(rawSelection());
    expect(events.picked).toHaveBeenCalledTimes(1);
    expect(browser.setOverlayVisible).toHaveBeenCalledWith(false);
    expect(findCandidates).toHaveBeenCalledWith([
      { text: 'Button', word: true },
      { text: 'Card', word: true },
      { text: 'btn', word: false },
    ]);
    const selection = events.selected.mock.calls[0]?.[0];
    expect(selection?.components[0]?.definedIn?.relative).toBe('src/components/Button.tsx');
    expect(selection?.components[0]?.renderedIn).toMatchObject({ relative: 'src/components/Card.tsx', line: 19 });
    // A file that no longer exists is not offered as a source.
    expect(selection?.components[1]?.definedIn).toBeNull();
    expect(selection?.consoleErrors).toEqual(['boom']);
    expect(selection?.screenshot.dataUrl).toBe('data:image/png;base64,iVBOR');
  });

  it('drops a selection that resolves after the mode was left', async () => {
    const { service, browser, events } = setup();
    service.setInspecting(true);
    let release: () => void = () => undefined;
    browser.setOverlayVisible.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = service.select(rawSelection());
    service.setInspecting(false);
    release();
    await pending;
    expect(events.selected).not.toHaveBeenCalled();
  });

  it('reports capture failures', async () => {
    const { service, browser, events } = setup();
    service.setInspecting(true);
    browser.screenshot.mockImplementationOnce(() => Promise.reject(new Error('The capture was empty')));
    await service.select(rawSelection());
    expect(events.ended).toHaveBeenCalledWith('The capture was empty');
  });

  it('submits to a new thread with the request as title and file links for a text-only agent', async () => {
    const { service, events, agents, prompts, prompted } = setup({ image: false });
    service.setInspecting(true);
    await service.select(rawSelection());
    const id = events.selected.mock.calls[0]?.[0].id ?? '';
    const result = service.submit({
      selectionId: id,
      targetIndex: 0,
      text: 'make this button red',
      include: { screenshot: false, sources: true, context: true },
      target: { type: 'new', agentId: 'fake' },
    });
    expect(result).toEqual({ threadId: 'new-thread' });
    expect(agents.createThread).toHaveBeenCalledWith('fake', { model: undefined });
    await prompted;
    const sent = prompts[0];
    expect(sent?.title).toBe('make this button red');
    const text = sent?.blocks[0]?.type === 'text' ? sent.blocks[0].text : '';
    expect(text).toContain('Rendered at: src/components/Card.tsx:19');
    expect(text).toContain('- boom');
    expect(sent?.blocks.slice(1).map((b) => b.type)).toEqual(['resource_link', 'resource_link']);
    // The selection is used up.
    expect(() =>
      service.submit({
        selectionId: id,
        targetIndex: 0,
        text: 'again',
        include: { screenshot: false, sources: false, context: false },
        target: { type: 'thread', threadId: 'new-thread' },
      }),
    ).toThrow(/no longer current/);
  });
});
