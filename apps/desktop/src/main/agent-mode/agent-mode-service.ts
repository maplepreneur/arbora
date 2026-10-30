import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { nativeImage } from 'electron';
import { composePrompt, type PromptScreenshot } from '@arbora/browser-bridge';
import {
  targetComponent,
  type AgentModeInclude,
  type AgentModeSelection,
  type AgentModeTarget,
  type InspectorSelection,
  type Rect,
  type ResolvedComponent,
  type ScreenshotResult,
  type SourceCandidate,
} from '@arbora/shared';
import type { AgentService } from '../agent/agent-service.js';
import type { BrowserService } from '../browser/browser-service.js';
import { drawOutline, fitWithin, scaleRect } from '../browser/image.js';
import { projectRelative, resolveSource } from './source-paths.js';
import { searchTerms, type SearchTerm } from './source-search.js';

/** Agents downscale anything larger; Claude's documented limit is 1568 px on the long edge. */
export const MAX_IMAGE_EDGE = 1568;
/** PNG screenshots above this many bytes are re-encoded as JPEG. */
const MAX_PNG_BYTES = 1_500_000;
const JPEG_QUALITY = 85;
const OUTLINE_CSS_PX = 2;

export interface AgentModeEvents {
  picked(): void;
  selected(selection: AgentModeSelection): void;
  ended(error?: string): void;
}

export interface AgentModeServiceOptions {
  readonly projectPath: string;
  readonly browser: () => BrowserService | null;
  readonly agents: () => AgentService | null;
  readonly findCandidates: (terms: readonly SearchTerm[]) => Promise<SourceCandidate[]>;
  readonly events: AgentModeEvents;
}

export interface AgentModeSubmit {
  readonly selectionId: string;
  readonly targetIndex: number;
  readonly text: string;
  readonly include: AgentModeInclude;
  readonly target: AgentModeTarget;
}

interface StoredSelection {
  readonly id: string;
  readonly raw: InspectorSelection;
  readonly components: ResolvedComponent[];
  readonly candidates: SourceCandidate[];
  readonly consoleErrors: string[];
  readonly shot: ScreenshotResult;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Agent mode for one project window: starts and stops the page inspector, turns a page selection
 * into an `AgentModeSelection` (clean screenshot, sources mapped onto project files, grep
 * candidates, console errors) and sends the composed prompt to a thread.
 */
export class AgentModeService {
  private active = false;
  private seq = 0;
  private selection: StoredSelection | null = null;

  constructor(private readonly options: AgentModeServiceOptions) {}

  setInspecting(active: boolean): void {
    this.active = active;
    this.seq++;
    this.selection = null;
    this.options.browser()?.setInspecting(active);
  }

  cancelledInPage(): void {
    if (this.active) this.options.events.ended();
  }

  async select(raw: InspectorSelection): Promise<void> {
    const browser = this.options.browser();
    if (!this.active || !browser) return;
    const seq = ++this.seq;
    this.options.events.picked();
    try {
      await browser.setOverlayVisible(false);
      const shot = await browser.screenshot({ mode: 'viewport' });
      const root = this.options.projectPath;
      const components = raw.components.map((c) => ({
        ...c,
        definedIn: resolveSource(c.definedAt, root, isFile),
        renderedIn: resolveSource(c.renderedAt, root, isFile),
      }));
      const candidates = await this.options.findCandidates(searchTerms(raw)).catch(() => []);
      // `setInspecting` bumps `seq`, so this also drops results that arrive after leaving the mode.
      if (seq !== this.seq) return;
      const stored: StoredSelection = {
        id: randomUUID(),
        raw,
        components,
        candidates,
        consoleErrors: browser.consoleErrorsSinceNavigation(),
        shot,
      };
      this.selection = stored;
      this.options.events.selected({
        ...raw,
        id: stored.id,
        components,
        candidates,
        consoleErrors: stored.consoleErrors,
        screenshot: { dataUrl: `data:image/png;base64,${shot.pngBase64}`, width: shot.width, height: shot.height },
      });
    } catch (error) {
      if (seq === this.seq) this.options.events.ended((error as Error).message);
    }
  }

  /**
   * Hands the prompt to a thread and resolves with its id straight away. Starting the agent (and
   * learning whether it takes images) can take a while; the thread shows that progress.
   */
  submit(request: AgentModeSubmit): { threadId: string } {
    const stored = this.selection;
    if (stored?.id !== request.selectionId)
      throw new Error('The selection is no longer current; pick the element again');
    const agents = this.options.agents();
    const browser = this.options.browser();
    if (!agents || !browser) throw new Error('Open a project first');

    if (request.target.type === 'thread') {
      const status = agents.getThread(request.target.threadId)?.state.status;
      if (status === 'prompting')
        throw new Error('That thread is still working. Stop it first, or send to a new thread.');
    }
    const threadId =
      request.target.type === 'thread' ? request.target.threadId : agents.createThread(request.target.agentId).id;
    const target = targetComponent({ components: stored.components, targetIndex: request.targetIndex });
    const screenshot = request.include.screenshot
      ? this.writeScreenshot(browser, stored, target?.rect ?? stored.raw.element.rect)
      : null;
    this.selection = null;
    void this.send(agents, threadId, stored, request, screenshot).catch((error: unknown) => {
      console.warn(`[agent-mode] prompt failed: ${(error as Error).message}`);
    });
    return { threadId };
  }

  private async send(
    agents: AgentService,
    threadId: string,
    stored: StoredSelection,
    request: AgentModeSubmit,
    screenshot: PromptScreenshot | null,
  ): Promise<void> {
    const capabilities = await agents.promptCapabilities(threadId);
    const { blocks } = composePrompt({
      request: request.text,
      url: stored.raw.url,
      framework: stored.raw.framework,
      components: stored.components,
      targetIndex: request.targetIndex,
      selector: stored.raw.selector,
      element: stored.raw.element,
      candidates: stored.candidates,
      consoleErrors: stored.consoleErrors,
      notes: stored.raw.notes,
      include: request.include,
      screenshot,
      imageSupported: capabilities?.image ?? false,
      toUri: (path) => pathToFileURL(path).toString(),
    });
    await agents.prompt(threadId, blocks, [], { title: request.text });
  }

  /** Burns the outline into the stored capture, downscales it and saves it next to other screenshots. */
  private writeScreenshot(browser: BrowserService, stored: StoredSelection, highlight: Rect): PromptScreenshot {
    const { shot } = stored;
    const image = nativeImage.createFromBuffer(Buffer.from(shot.pngBase64, 'base64'));
    const bitmap = image.toBitmap();
    drawOutline(bitmap, shot.width, shot.height, scaleRect(highlight, shot.dpr), OUTLINE_CSS_PX * shot.dpr);
    let outlined = nativeImage.createFromBitmap(bitmap, { width: shot.width, height: shot.height });
    const size = fitWithin(shot.width, shot.height, MAX_IMAGE_EDGE);
    if (size.width !== shot.width) outlined = outlined.resize({ ...size, quality: 'best' });
    let data = outlined.toPNG();
    let mimeType = 'image/png';
    if (data.byteLength > MAX_PNG_BYTES) {
      data = outlined.toJPEG(JPEG_QUALITY);
      mimeType = 'image/jpeg';
    }
    const path = browser.writeScreenshotFile(data, 'agent-mode', mimeType === 'image/png' ? 'png' : 'jpg');
    return {
      path,
      relative: projectRelative(path, this.options.projectPath),
      uri: pathToFileURL(path).toString(),
      mimeType,
      data: data.toString('base64'),
    };
  }
}
