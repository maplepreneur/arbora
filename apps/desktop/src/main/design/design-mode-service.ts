import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeImage } from 'electron';
import { composeDesignPrompt, type PromptScreenshot } from '@arbora/browser-bridge';
import {
  activeOps,
  designOpSchema,
  planWriteThrough,
  renderChangeList,
  renderSessionMarkdown,
  type DesignSessionDetail,
  type AgentModeTarget,
  type ContentBlock,
  type DesignCommand,
  type DesignOp,
  type DesignSessionSummary,
  type DesignState,
  type FrameworkInfo,
  type ResolvedSource,
  type ScreenshotResult,
  type StylingApproach,
} from '@arbora/shared';
import type { AgentService } from '../agent/agent-service.js';
import { fitWithin } from '../browser/image.js';
import type { BrowserService } from '../browser/browser-service.js';
import { projectRelative, resolveSource } from '../agent-mode/source-paths.js';
import type { SearchTerm } from '../agent-mode/source-search.js';
import { commitWriteThrough, prepareWriteThrough } from './apply-write-through.js';
import { detectProjectStyling } from './styling.js';

/** Agents downscale anything larger; Claude's documented limit is 1568 px on the long edge. */
const MAX_IMAGE_EDGE = 1568;
const MAX_PNG_BYTES = 1_500_000;
const JPEG_QUALITY = 85;

export interface DesignModeEvents {
  state(state: DesignState): void;
  failed(error: string): void;
}

export interface DesignModeServiceOptions {
  readonly projectPath: string;
  readonly browser: () => BrowserService | null;
  readonly agents: () => AgentService | null;
  readonly findCandidates: (terms: readonly SearchTerm[]) => Promise<{ path: string; relative: string }[]>;
  readonly events: DesignModeEvents;
}

interface DesignDelivery {
  readonly url: string;
  readonly framework: FrameworkInfo;
  readonly approach: StylingApproach;
  readonly changes: string;
  readonly sources: readonly ResolvedSource[];
  readonly before: PromptScreenshot;
  readonly after: PromptScreenshot;
  readonly title: string;
}

interface DraftFile {
  readonly url: string;
  readonly ops: DesignOp[];
  readonly cursor: number;
}

interface SessionFile {
  readonly id: string;
  readonly createdAt: string;
  readonly url: string;
  readonly approach: StylingApproach;
  readonly changes: string;
  readonly framework: FrameworkInfo;
  readonly sources: ResolvedSource[];
  readonly before: string;
  readonly after: string;
  readonly opCount: number;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Design mode for one project window. The page owns the live op list; this service takes the
 * before/after screenshots, persists a draft so a crash does not lose it, and on save reverts the
 * DOM before the agent starts so the agent does not see its own preview.
 */
export class DesignModeService {
  private active = false;
  private generation = 0;
  private state: DesignState | null = null;
  private before: PromptScreenshot | null = null;

  constructor(private readonly options: DesignModeServiceOptions) {}

  get editing(): boolean {
    return this.active;
  }

  setActive(active: boolean): void {
    if (active) void this.enter();
    else this.leave((this.state?.cursor ?? 0) === 0);
  }

  command(command: DesignCommand): void {
    if (!this.active) throw new Error('Design mode is not active');
    const browser = this.options.browser();
    if (!browser) throw new Error('Open a project first');
    browser.sendDesignCommand(command);
  }

  /** The page mirrored its op list. Persisted immediately so a crash keeps the edits. */
  onState(state: DesignState): void {
    if (!this.active) return;
    this.state = state;
    this.options.events.state(state);
    const browser = this.options.browser();
    browser?.setDesignGuard(state.cursor > 0);
    browser?.rememberDesign({ ops: state.ops, cursor: state.cursor });
    if (state.cursor > 0) {
      this.writeDraft({ url: browser?.getState().url ?? '', ops: state.ops, cursor: state.cursor });
    }
  }

  /** A reload with no edits yet: the before screenshot has to match the new document. */
  async onDocumentNavigated(): Promise<void> {
    if (!this.active || (this.state?.cursor ?? 0) > 0) return;
    const browser = this.options.browser();
    if (!browser) return;
    try {
      this.before = this.prepare(browser, await browser.screenshot({ mode: 'viewport' }), 'design-before');
    } catch (error) {
      console.warn(`[design] could not retake the before screenshot: ${(error as Error).message}`);
    }
  }

  discard(): void {
    this.deleteDraft();
    this.leave(true);
  }

  listSessions(): DesignSessionSummary[] {
    const dir = join(this.options.projectPath, '.arbora', 'design-sessions');
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const sessions: DesignSessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'draft.json') continue;
      const session = this.readSession(join(dir, name));
      if (!session) continue;
      sessions.push({
        id: session.id,
        createdAt: session.createdAt,
        url: session.url,
        opCount: session.opCount,
        approach: session.approach,
      });
    }
    return sessions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /**
   * Captures the after screenshot, writes the session, reverts the live DOM and sends the prompt.
   * Resolves once the agent has the prompt, with the thread it went to.
   */
  async save(target: AgentModeTarget): Promise<{ threadId: string }> {
    const browser = this.options.browser();
    const state = this.state;
    if (!this.active || !browser || !state) throw new Error('Design mode is not active');
    if (!this.before) throw new Error('There is no before screenshot yet. Load the page, then edit it.');
    const applied = activeOps(state.ops, state.cursor);
    if (applied.length === 0) throw new Error('Nothing to save: every change is switched off');
    this.checkTarget(target);
    // The after screenshot must show the edits even if the user left the compare toggle on.
    browser.sendDesignCommand({ type: 'showOriginal', on: false });
    await browser.setDesignOverlayVisible(false);
    const after = this.prepare(browser, await browser.screenshot({ mode: 'viewport' }), 'design-after');
    const styling = detectProjectStyling(this.options.projectPath);
    const changes = renderChangeList(applied, styling.approach, styling.colors);
    const sources = await this.sourcesFor(applied);
    const session = this.writeSession({
      url: browser.getState().url,
      approach: styling.approach,
      changes,
      framework: state.framework,
      sources,
      before: this.before.path,
      after: after.path,
      opCount: applied.length,
    });
    this.deleteDraft();
    this.leave(true);
    const threadId = this.send(target, {
      url: session.url,
      framework: session.framework,
      approach: session.approach,
      changes,
      sources,
      before: this.before,
      after,
      title: 'Design changes',
    });
    this.before = null;
    return { threadId };
  }

  /** Tailwind, CSS modules, or plain CSS, plus config colours the class mapper knows. */
  styling(): { approach: StylingApproach; colors: { hex: string; name: string }[] } {
    const styling = detectProjectStyling(this.options.projectPath);
    return {
      approach: styling.approach,
      colors: [...styling.colors.entries()].slice(0, 400).map(([hex, name]) => ({ hex, name })),
    };
  }

  /**
   * Writes every applied style as a Tailwind class on its tier-1 source tag, reverts the live
   * DOM, and records a session. The agent is not prompted.
   */
  async writeThrough(): Promise<{ files: string[]; sessionId: string }> {
    const browser = this.options.browser();
    const state = this.state;
    if (!this.active || !browser || !state) throw new Error('Design mode is not active');
    if (!this.before) throw new Error('There is no before screenshot yet. Load the page, then edit it.');
    const applied = activeOps(state.ops, state.cursor);
    if (applied.length === 0) throw new Error('Nothing to apply: every change is switched off');
    const styling = detectProjectStyling(this.options.projectPath);
    const plan = planWriteThrough(applied, styling.approach, styling.colors);
    if (!plan.ok) throw new Error(plan.reason);
    // Refuse before touching the disk when a tag cannot take a class edit.
    const prepared = prepareWriteThrough(this.options.projectPath, plan.edits);
    browser.sendDesignCommand({ type: 'showOriginal', on: false });
    await browser.setDesignOverlayVisible(false);
    const after = this.prepare(browser, await browser.screenshot({ mode: 'viewport' }), 'design-after');
    commitWriteThrough(prepared);
    const files = prepared.map((file) => file.relative);
    const changes = `Applied to source.\n\n${renderChangeList(applied, styling.approach, styling.colors)}`;
    const sources = await this.sourcesFor(applied);
    const session = this.writeSession({
      url: browser.getState().url,
      approach: styling.approach,
      changes,
      framework: state.framework,
      sources,
      before: this.before.path,
      after: after.path,
      opCount: applied.length,
    });
    this.deleteDraft();
    this.leave(true);
    this.before = null;
    return { files, sessionId: session.id };
  }

  /** Change list, Markdown, and the before/after screenshots for one saved session. */
  readSessionDetail(id: string): DesignSessionDetail {
    const session = this.readSession(this.sessionFile(id));
    if (!session) throw new Error('That design session is gone');
    const beforeRelative = this.projectFile(session.before);
    const afterRelative = this.projectFile(session.after);
    const sources = session.sources.slice(0, 8).map((source) => ({
      relative: source.relative,
      line: source.line,
    }));
    const markdown = renderSessionMarkdown({
      createdAt: session.createdAt,
      url: session.url,
      approach: session.approach,
      opCount: session.opCount,
      changes: session.changes,
      framework: session.framework.id,
      sources,
      beforeRelative,
      afterRelative,
    });
    return {
      id: session.id,
      createdAt: session.createdAt,
      url: session.url,
      approach: session.approach,
      opCount: session.opCount,
      changes: session.changes,
      markdown,
      sources,
      beforeUrl: beforeRelative ? this.imageDataUrl(session.before) : null,
      afterUrl: afterRelative ? this.imageDataUrl(session.after) : null,
    };
  }

  resend(id: string, target: AgentModeTarget): { threadId: string } {
    const session = this.readSession(this.sessionFile(id));
    if (!session) throw new Error('That design session is gone');
    const before = this.shotFromFile(session.before);
    const after = this.shotFromFile(session.after);
    const threadId = this.send(target, { ...session, before, after, title: 'Design changes (resent)' });
    return { threadId };
  }

  private async enter(): Promise<void> {
    const generation = ++this.generation;
    const browser = this.options.browser();
    if (!browser) {
      this.options.events.failed('Open a project first');
      return;
    }
    this.active = true;
    const page = browser.getState();
    if (!page.url || page.error) {
      // Nothing to capture yet. `onDocumentNavigated` takes the before screenshot once a page loads.
      this.before = null;
      browser.beginDesign({ ops: [], cursor: 0 });
      return;
    }
    try {
      const shot = await browser.screenshot({ mode: 'viewport' });
      if (generation !== this.generation) return;
      this.before = this.prepare(browser, shot, 'design-before');
      const url = browser.getState().url;
      const draft = this.readDraft();
      const saved = draft && draft.url === url ? { ops: draft.ops, cursor: draft.cursor } : { ops: [], cursor: 0 };
      browser.beginDesign(saved);
    } catch (error) {
      if (generation !== this.generation) return;
      this.active = false;
      this.options.events.failed((error as Error).message);
    }
  }

  /** `deleteDraft` is set when leaving with nothing applied, so the next entry starts clean. */
  private leave(deleteDraft: boolean): void {
    this.generation++;
    if (deleteDraft) this.deleteDraft();
    if (!this.active) return;
    this.active = false;
    this.state = null;
    this.options.browser()?.endDesign(true);
  }

  private async sourcesFor(ops: readonly DesignOp[]): Promise<ResolvedSource[]> {
    const seen = new Set<string>();
    const sources: ResolvedSource[] = [];
    const add = (source: ResolvedSource | null): void => {
      if (!source || seen.has(source.path)) return;
      seen.add(source.path);
      sources.push(source);
    };
    for (const op of ops) {
      if (!op.target.sourceFile) continue;
      add(
        resolveSource(
          { file: op.target.sourceFile, line: op.target.sourceLine, column: null },
          this.options.projectPath,
          isFile,
        ),
      );
    }
    if (sources.length > 0) return sources.slice(0, 8);
    const terms: SearchTerm[] = [];
    const names = new Set<string>();
    for (const op of ops) {
      for (const name of op.target.componentChain) {
        if (name.length < 3 || names.has(name)) continue;
        names.add(name);
        terms.push({ text: name, word: true });
      }
    }
    if (terms.length === 0) return [];
    const found = await this.options.findCandidates(terms.slice(0, 6)).catch(() => []);
    for (const candidate of found) {
      add({ path: candidate.path, relative: candidate.relative, line: null, column: null });
    }
    return sources.slice(0, 8);
  }

  /** Throws before anything is captured or reverted when the target cannot take a prompt. */
  private checkTarget(target: AgentModeTarget): AgentService {
    const agents = this.options.agents();
    if (!agents) throw new Error('Open a project first');
    if (target.type === 'thread') {
      const status = agents.getThread(target.threadId)?.state.status;
      if (status === 'prompting')
        throw new Error('That thread is still working. Stop it first, or send to a new thread.');
    }
    return agents;
  }

  /**
   * Picks or creates the thread and resolves with it straight away, so the agent panel can show the
   * agent starting and working. The prompt is delivered in the background.
   */
  private send(target: AgentModeTarget, input: DesignDelivery): string {
    const agents = this.checkTarget(target);
    const threadId =
      target.type === 'thread' ? target.threadId : agents.createThread(target.agentId, { model: target.model }).id;
    void this.deliver(agents, threadId, input).catch((error: unknown) => {
      console.warn(`[design] prompt failed: ${(error as Error).message}`);
    });
    return threadId;
  }

  private async deliver(agents: AgentService, threadId: string, input: DesignDelivery): Promise<void> {
    const capabilities = await agents.promptCapabilities(threadId);
    const blocks: ContentBlock[] = composeDesignPrompt({
      url: input.url,
      framework: input.framework,
      approach: input.approach,
      changes: input.changes,
      sources: input.sources,
      before: input.before,
      after: input.after,
      imageSupported: capabilities?.image ?? false,
      toUri: (path) => pathToFileURL(path).toString(),
    });
    await agents.prompt(threadId, blocks, [], { title: input.title });
  }

  private prepare(browser: BrowserService, shot: ScreenshotResult, label: string): PromptScreenshot {
    const image = nativeImage.createFromBuffer(Buffer.from(shot.pngBase64, 'base64'));
    const size = fitWithin(shot.width, shot.height, MAX_IMAGE_EDGE);
    const sized = size.width === shot.width ? image : image.resize({ ...size, quality: 'best' });
    let data = sized.toPNG();
    let mimeType = 'image/png';
    let extension: 'png' | 'jpg' = 'png';
    if (data.byteLength > MAX_PNG_BYTES) {
      data = sized.toJPEG(JPEG_QUALITY);
      mimeType = 'image/jpeg';
      extension = 'jpg';
    }
    const path = browser.writeScreenshotFile(data, label, extension);
    return {
      path,
      relative: projectRelative(path, this.options.projectPath),
      uri: pathToFileURL(path).toString(),
      mimeType,
      data: data.toString('base64'),
    };
  }

  private shotFromFile(path: string): PromptScreenshot {
    const data = readFileSync(path);
    const mimeType = path.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    return {
      path,
      relative: projectRelative(path, this.options.projectPath),
      uri: pathToFileURL(path).toString(),
      mimeType,
      data: data.toString('base64'),
    };
  }

  private sessionFile(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('That design session is gone');
    }
    return join(this.sessionsDir(), `${id}.json`);
  }

  /** Project-relative path, or null when `path` is outside the project. */
  private projectFile(path: string): string | null {
    const relative = projectRelative(path, this.options.projectPath);
    if (!relative || relative.startsWith('..') || isAbsolute(relative)) return null;
    return relative;
  }

  private imageDataUrl(path: string): string | null {
    try {
      const info = statSync(path);
      if (!info.isFile() || info.size > 1_800_000) return null;
      const mime = path.endsWith('.jpg') || path.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
      return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
    } catch {
      return null;
    }
  }

  private sessionsDir(): string {
    const dir = join(this.options.projectPath, '.arbora', 'design-sessions');
    mkdirSync(dir, { recursive: true });
    const ignore = join(dir, '.gitignore');
    if (!existsSync(ignore)) writeFileSync(ignore, '# Arbora design sessions are local artefacts\n*\n');
    return dir;
  }

  private writeDraft(draft: DraftFile): void {
    writeFileSync(join(this.sessionsDir(), 'draft.json'), JSON.stringify(draft));
  }

  private readDraft(): DraftFile | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(this.sessionsDir(), 'draft.json'), 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const record = parsed as { url?: unknown; ops?: unknown; cursor?: unknown };
      const ops = z.array(designOpSchema).safeParse(record.ops);
      if (!ops.success || typeof record.url !== 'string') return null;
      const cursor = typeof record.cursor === 'number' ? Math.min(record.cursor, ops.data.length) : ops.data.length;
      return { url: record.url, ops: ops.data, cursor };
    } catch {
      return null;
    }
  }

  private deleteDraft(): void {
    rmSync(join(this.options.projectPath, '.arbora', 'design-sessions', 'draft.json'), { force: true });
  }

  private writeSession(input: Omit<SessionFile, 'id' | 'createdAt'>): SessionFile {
    const session: SessionFile = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    writeFileSync(join(this.sessionsDir(), `${session.id}.json`), JSON.stringify(session, null, 2));
    return session;
  }

  private readSession(path: string): SessionFile | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const session = parsed as Partial<SessionFile>;
      if (!session.id || !session.before || !session.after || !session.approach || !session.changes) return null;
      return session as SessionFile;
    } catch {
      return null;
    }
  }
}
