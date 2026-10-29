import type { ComponentEntry, Rect } from '@arbora/shared';
import { boxModel, edges, type BoxModel } from './box-model.js';

/** What the inspector needs from its embedder (the browser preload). */
export interface InspectorHost {
  /** Component chain (nearest first) for the element under a viewport point. */
  chainAt(x: number, y: number): Promise<ComponentEntry[]>;
  /** The user clicked `element` (or picked breadcrumb entry `targetIndex` for it). */
  select(element: Element, targetIndex: number): void;
  /** `Esc` reached the page. */
  cancel(): void;
}

type State = 'off' | 'hover' | 'selected';

/** The page's window, including its DOM constructors (`instanceof` must use the page's own). */
export type PageWindow = Window & typeof globalThis;

/** Events the page must not see while the inspector is active. */
const BLOCKED_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
  'mousedown',
  'mouseup',
  'mousemove',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend',
  'touchmove',
  'keydown',
  'keyup',
  'keypress',
] as const;

const COLORS = {
  margin: 'rgba(246, 178, 107, 0.55)',
  border: 'rgba(255, 229, 153, 0.6)',
  padding: 'rgba(147, 196, 125, 0.5)',
  content: 'rgba(111, 168, 220, 0.55)',
  accent: '#7c3aed',
} as const;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 11px/1.4 ui-sans-serif, system-ui, sans-serif; }
.box { position: fixed; pointer-events: none; box-sizing: border-box; }
.margin { background: ${COLORS.margin}; }
.border { background: ${COLORS.border}; }
.padding { background: ${COLORS.padding}; }
.content { background: ${COLORS.content}; }
.outline { outline: 2px solid ${COLORS.accent}; outline-offset: -1px; background: transparent; }
.label { position: fixed; display: flex; gap: 6px; align-items: center; max-width: 60vw; padding: 2px 6px; border-radius: 4px;
  background: #111827; color: #f9fafb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.label .name { color: #c4b5fd; font-weight: 600; }
.label .dim { color: #9ca3af; }
.crumbs { position: fixed; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; gap: 2px; align-items: center; padding: 4px 8px;
  background: rgba(17, 24, 39, 0.92); color: #e5e7eb; pointer-events: auto; }
.crumbs .hint { color: #9ca3af; margin-right: 8px; }
.crumb { all: unset; cursor: pointer; padding: 1px 6px; border-radius: 3px; color: #e5e7eb; }
.crumb:hover, .crumb.active { background: ${COLORS.accent}; color: #fff; }
.sep { color: #6b7280; }
.tag { color: #93c5fd; padding: 1px 4px; }
.hidden { display: none !important; }
`;

function setRect(el: HTMLElement, rect: Rect): void {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
}

function describeTag(el: Element): string {
  const classes = Array.from(el.classList).slice(0, 2);
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${classes.map((c) => `.${c}`).join('')}`;
}

/**
 * Agent mode's in-page overlay: DevTools-style box model on hover, a label chip and a breadcrumb of
 * the component chain. Lives in a closed shadow root on a fixed host attached to `<html>` (not
 * `<body>`, which frameworks replace on HMR), re-attached by a MutationObserver if removed.
 *
 * The capture-phase listeners are installed once, when the preload starts, so they run before any
 * listener the page adds to `window`; they do nothing unless the inspector is active.
 */
export class Inspector {
  private state: State = 'off';
  private readonly host: HTMLElement;
  private readonly boxes: Record<keyof BoxModel, HTMLElement>;
  private readonly outline: HTMLElement;
  private readonly label: HTMLElement;
  private readonly crumbs: HTMLElement;
  private readonly observer: MutationObserver;
  private hovered: Element | null = null;
  private selected: Element | null = null;
  private chain: ComponentEntry[] = [];
  private chainFor: Element | null = null;
  private chainSeq = 0;
  private frame = 0;
  private lastPoint: { x: number; y: number; target: Element } | null = null;
  private focusBefore: Element | null = null;
  private cursorSheet: CSSStyleSheet | null = null;

  constructor(
    private readonly win: PageWindow,
    private readonly callbacks: InspectorHost,
  ) {
    const doc = win.document;
    this.host = doc.createElement('div');
    this.host.setAttribute('data-arbora-overlay', '');
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = STYLE;
    const layer = doc.createElement('div');
    layer.className = 'layer';
    const box = (name: string): HTMLElement => {
      const el = doc.createElement('div');
      el.className = `box ${name}`;
      layer.append(el);
      return el;
    };
    this.boxes = { margin: box('margin'), border: box('border'), padding: box('padding'), content: box('content') };
    this.outline = box('outline');
    this.label = doc.createElement('div');
    this.label.className = 'label';
    this.crumbs = doc.createElement('div');
    this.crumbs.className = 'crumbs';
    layer.append(this.label, this.crumbs);
    root.append(style, layer);

    this.observer = new win.MutationObserver(() => {
      if (this.state !== 'off' && !this.host.isConnected) this.attach();
    });
    for (const type of BLOCKED_EVENTS) win.addEventListener(type, this.onEvent, { capture: true });
    win.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    win.addEventListener('resize', this.onScroll, { passive: true });
  }

  get active(): boolean {
    return this.state !== 'off';
  }

  /** Starts (or restarts after a selection) the hover highlight. */
  start(): void {
    if (this.state === 'off') this.focusBefore = this.win.document.activeElement;
    this.state = 'hover';
    this.selected = null;
    this.attach();
    this.setCursor(true);
    this.render();
  }

  stop(): void {
    if (this.state === 'off') return;
    this.state = 'off';
    this.hovered = null;
    this.selected = null;
    this.chain = [];
    this.chainFor = null;
    this.lastPoint = null;
    this.win.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.observer.disconnect();
    this.host.remove();
    this.setCursor(false);
    const previous = this.focusBefore;
    this.focusBefore = null;
    if (
      previous instanceof this.win.HTMLElement &&
      previous.isConnected &&
      this.win.document.activeElement !== previous
    ) {
      previous.focus({ preventScroll: true });
    }
  }

  /** Hides the overlay without leaving the mode (for clean screenshots). */
  setVisible(visible: boolean): void {
    this.host.style.display = visible ? '' : 'none';
  }

  /** Removes listeners and the host; the inspector cannot be used afterwards. */
  dispose(): void {
    this.stop();
    for (const type of BLOCKED_EVENTS) this.win.removeEventListener(type, this.onEvent, { capture: true });
    this.win.removeEventListener('scroll', this.onScroll, { capture: true });
    this.win.removeEventListener('resize', this.onScroll);
  }

  private attach(): void {
    const html = this.win.document.documentElement;
    if (!this.host.isConnected) html.append(this.host);
    this.observer.disconnect();
    this.observer.observe(html, { childList: true });
  }

  private setCursor(on: boolean): void {
    const doc = this.win.document;
    try {
      if (on && !this.cursorSheet) {
        const sheet = new this.win.CSSStyleSheet();
        sheet.replaceSync('*, *::before, *::after { cursor: crosshair !important; }');
        this.cursorSheet = sheet;
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
      } else if (!on && this.cursorSheet) {
        const sheet = this.cursorSheet;
        this.cursorSheet = null;
        doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
      }
    } catch {
      // Constructable stylesheets unavailable; the default cursor is fine.
    }
  }

  private isOwn(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  private readonly onEvent = (event: Event): void => {
    if (this.state === 'off' || this.isOwn(event)) return;
    if (event.type === 'keydown' && (event as KeyboardEvent).key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.callbacks.cancel();
      return;
    }
    // Wheel and scroll stay with the page so the user can scroll to the element.
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = event.composedPath()[0];
    if (!target || !(target instanceof this.win.Element)) return;
    if (event.type === 'mousemove' || event.type === 'pointermove') {
      const mouse = event as MouseEvent;
      this.lastPoint = { x: mouse.clientX, y: mouse.clientY, target };
      if (this.state === 'hover') this.schedule();
    } else if (event.type === 'click' && this.state === 'hover') {
      this.choose(target, 0);
    }
  };

  private readonly onScroll = (): void => {
    if (this.state !== 'off') this.schedule();
  };

  private schedule(): void {
    this.frame ||= this.win.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.state === 'hover' && this.lastPoint) {
        const { target } = this.lastPoint;
        if (target !== this.hovered) {
          this.hovered = target;
          void this.loadChain(target, this.lastPoint.x, this.lastPoint.y);
        }
      }
      this.render();
    });
  }

  private async loadChain(target: Element, x: number, y: number): Promise<void> {
    const seq = ++this.chainSeq;
    this.chain = [];
    this.chainFor = target;
    let chain: ComponentEntry[] = [];
    try {
      chain = await this.callbacks.chainAt(x, y);
    } catch {
      // The page's main world is unavailable (navigating); show the tag only.
    }
    if (seq !== this.chainSeq || this.chainFor !== target) return;
    this.chain = chain;
    this.render();
  }

  private choose(element: Element, targetIndex: number): void {
    this.state = 'selected';
    this.selected = element;
    this.render();
    this.callbacks.select(element, targetIndex);
  }

  private render(): void {
    const element = this.state === 'selected' ? this.selected : this.hovered;
    const visible = this.state !== 'off' && element !== null;
    for (const el of [...Object.values(this.boxes), this.outline, this.label]) el.classList.toggle('hidden', !visible);
    this.renderCrumbs(element);
    if (!visible) return;
    const style = this.win.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const model = boxModel(
      { x: box.x, y: box.y, width: box.width, height: box.height },
      edges(style, 'margin'),
      edges(style, 'border', '-width'),
      edges(style, 'padding'),
    );
    for (const key of Object.keys(this.boxes) as (keyof BoxModel)[]) setRect(this.boxes[key], model[key]);
    setRect(this.outline, model.border);
    this.renderLabel(element, model.border);
  }

  private renderLabel(element: Element, rect: Rect): void {
    const doc = this.win.document;
    const nearest = this.chainFor === element ? this.chain[0] : undefined;
    this.label.replaceChildren();
    if (nearest) {
      const name = doc.createElement('span');
      name.className = 'name';
      name.textContent = nearest.minified ? 'anonymous component' : nearest.name;
      this.label.append(name);
    }
    const tag = doc.createElement('span');
    tag.textContent = describeTag(element);
    const dims = doc.createElement('span');
    dims.className = 'dim';
    dims.textContent = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    this.label.append(tag, dims);
    const above = rect.y - 24;
    this.label.style.left = `${Math.max(4, rect.x)}px`;
    this.label.style.top = `${above >= 4 ? above : Math.min(rect.y + rect.height + 4, this.win.innerHeight - 28)}px`;
  }

  private renderCrumbs(element: Element | null): void {
    const doc = this.win.document;
    this.crumbs.classList.toggle('hidden', this.state === 'off');
    this.crumbs.replaceChildren();
    const hint = doc.createElement('span');
    hint.className = 'hint';
    hint.textContent = this.state === 'selected' ? 'Selected' : 'Click an element · Esc to exit';
    this.crumbs.append(hint);
    if (!element) return;
    const chain = this.chainFor === element ? this.chain : [];
    // Root first, nearest last, then the element itself.
    chain
      .map((entry, index) => ({ entry, index }))
      .reverse()
      .forEach(({ entry, index }) => {
        const crumb = doc.createElement('button');
        crumb.className = 'crumb';
        crumb.textContent = entry.server ? `${entry.name} (server)` : entry.minified ? 'anonymous' : entry.name;
        crumb.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (this.state === 'hover') this.choose(element, index);
        });
        const sep = doc.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        this.crumbs.append(crumb, sep);
      });
    const tag = doc.createElement('span');
    tag.className = 'tag';
    tag.textContent = describeTag(element);
    this.crumbs.append(tag);
  }
}
