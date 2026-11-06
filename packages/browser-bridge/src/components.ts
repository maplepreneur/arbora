import type { ComponentEntry } from '@arbora/shared';

/**
 * Resolves the component chain (nearest first) for a DOM element, for React and Vue dev builds.
 * Runs in the page's main world and is injected as source text (see `main-world.ts`), so it must
 * not reference anything outside its own body.
 *
 * React <= 18 dev builds give file:line per fiber (`_debugSource`); React 19 only gives owner
 * stacks (`_debugStack`). A `.tsx` or `.vue` frame's line is transformed code and is dropped. A
 * production `.js` bundle keeps its line and column so main can apply the script's source map.
 * Vue gives
 * `type.__file` without a line. Components with no source information at all are library
 * internals when the page provides source information elsewhere, and are dropped.
 */
export function resolveComponents(start: Element, limit: number): ComponentEntry[] {
  interface Source {
    file: string;
    line: number | null;
    column: number | null;
  }
  interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  interface Fiber {
    tag: number;
    type: unknown;
    return: Fiber | null;
    child: Fiber | null;
    sibling: Fiber | null;
    stateNode: unknown;
    _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } | null;
    _debugStack?: { stack?: unknown } | null;
    _debugOwner?: unknown;
    _debugInfo?: unknown;
  }
  interface VueInstance {
    type: { __name?: unknown; name?: unknown; displayName?: unknown; __file?: unknown } | null;
    parent: VueInstance | null;
    subTree: unknown;
  }

  // Turbopack flattens paths into chunk names (`..._next_dist_compiled_react-dom_...js`).
  const LIBRARY =
    /node_modules|\/\.vite\/deps\/|next[/_]dist[/_]|react-dom[/_.-]|react-server-dom|\/@vite\/|\/@id\/|^node:|<anonymous>/;
  const isLibrary = (file: string): boolean => LIBRARY.test(file);
  const isElement = (value: unknown): value is Element =>
    typeof value === 'object' && value !== null && (value as { nodeType?: unknown }).nodeType === 1;

  const unionRect = (elements: readonly Element[]): Rect | null => {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const el of elements) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
    }
    if (!Number.isFinite(left)) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const frames = (stack: unknown): { fn: string; file: string; line: number; column: number }[] => {
    if (typeof stack !== 'string') return [];
    const out: { fn: string; file: string; line: number; column: number }[] = [];
    for (const raw of stack.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('at ')) continue;
      const match = /^at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
      if (match?.[2] && match[3] && match[4])
        out.push({ fn: match[1] ?? '', file: match[2], line: Number(match[3]), column: Number(match[4]) });
    }
    return out;
  };
  // A `.js` bundle can be mapped. A `.tsx` or `.vue` frame's line is transformed code, so it is dropped.
  const generatedScript = (file: string): boolean => {
    const path = file.split(/[?#]/)[0] ?? file;
    return /^https?:\/\//i.test(file) && /\.(?:mjs|cjs|js)$/.test(path);
  };
  const stackSource = (stack: unknown, preferFn?: string): Source | null => {
    const list = frames(stack).filter((f) => !isLibrary(f.file));
    const named = preferFn ? list.find((f) => f.fn === preferFn || f.fn.endsWith(`.${preferFn}`)) : undefined;
    const frame = named ?? list[0];
    if (!frame) return null;
    const generated = generatedScript(frame.file);
    return { file: frame.file, line: generated ? frame.line : null, column: generated ? frame.column : null };
  };
  const isMinified = (name: string): boolean => /^[A-Za-z_$][\w$]?$/.test(name);

  // --- React ---------------------------------------------------------------------------------
  const FUNCTION_TAGS = new Set([0, 1, 2, 11, 14, 15]);
  const HOST_TAGS = new Set([5, 26, 27]);
  const fiberOf = (node: Node | null): Fiber | null => {
    for (let current: Node | null = node; current;) {
      const key = Object.keys(current).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
      );
      if (key) return (current as unknown as Record<string, Fiber>)[key] ?? null;
      current = current.parentNode ?? (current as unknown as { host?: Node }).host ?? null;
    }
    return null;
  };
  const reactName = (type: unknown): string | null => {
    if (typeof type === 'function') {
      const fn = type as { displayName?: unknown; name?: unknown };
      const name = typeof fn.displayName === 'string' ? fn.displayName : fn.name;
      return typeof name === 'string' && name ? name : null;
    }
    if (typeof type === 'object' && type !== null) {
      const wrapper = type as { displayName?: unknown; render?: unknown; type?: unknown };
      if (typeof wrapper.displayName === 'string' && wrapper.displayName) return wrapper.displayName;
      return reactName(wrapper.render) ?? reactName(wrapper.type);
    }
    return null;
  };
  const debugSource = (fiber: Fiber): Source | null => {
    const src = fiber._debugSource;
    if (!src || typeof src.fileName !== 'string') return null;
    return {
      file: src.fileName,
      line: typeof src.lineNumber === 'number' ? src.lineNumber : null,
      column: typeof src.columnNumber === 'number' ? src.columnNumber : null,
    };
  };
  const hostNodes = (fiber: Fiber): Element[] => {
    const out: Element[] = [];
    const visit = (node: Fiber | null, depth: number): void => {
      for (let current = node; current && out.length < 50; current = current.sibling) {
        if (HOST_TAGS.has(current.tag) && isElement(current.stateNode)) out.push(current.stateNode);
        else if (depth < 40) visit(current.child, depth + 1);
      }
    };
    visit(fiber.child, 0);
    return out;
  };
  /** The source of an element `owner` created while rendering: its definition file. */
  const ownedSource = (owner: Fiber, name: string): Source | null => {
    const queue: Fiber[] = owner.child ? [owner.child] : [];
    for (let visited = 0; queue.length > 0 && visited < 400; visited++) {
      const fiber = queue.shift();
      if (!fiber) break;
      if (fiber._debugOwner === owner) {
        const source = debugSource(fiber) ?? stackSource(fiber._debugStack?.stack, name);
        if (source && !isLibrary(source.file)) return source;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return null;
  };
  const serverComponents = (fiber: Fiber): ComponentEntry[] => {
    if (!Array.isArray(fiber._debugInfo)) return [];
    const out: ComponentEntry[] = [];
    for (const info of fiber._debugInfo as unknown[]) {
      if (typeof info !== 'object' || info === null) continue;
      const { name, env } = info as { name?: unknown; env?: unknown };
      if (typeof name !== 'string' || !name || (typeof env === 'string' && env !== 'Server')) continue;
      out.push({
        name,
        minified: false,
        server: true,
        definedAt: null,
        renderedAt: null,
        rect: null,
      });
    }
    // `_debugInfo` lists the outermost server component first; the chain is nearest first.
    return out.reverse();
  };

  const react = (): ComponentEntry[] | null => {
    const first = fiberOf(start);
    if (!first) return null;
    const out: ComponentEntry[] = [];
    const seenServer = new Set<string>();
    for (let fiber: Fiber | null = first; fiber && out.length < limit * 4; fiber = fiber.return) {
      if (FUNCTION_TAGS.has(fiber.tag)) {
        const name = reactName(fiber.type);
        const previous = out[out.length - 1];
        if (name && !(previous && previous.name === name && !previous.server)) {
          const renderedAt = debugSource(fiber) ?? stackSource(fiber._debugStack?.stack);
          out.push({
            name,
            minified: isMinified(name),
            server: false,
            definedAt: ownedSource(fiber, name),
            renderedAt: renderedAt && !isLibrary(renderedAt.file) ? renderedAt : null,
            rect: unionRect(hostNodes(fiber)),
          });
        }
      }
      for (const server of serverComponents(fiber)) {
        if (seenServer.has(server.name)) continue;
        seenServer.add(server.name);
        out.push(server);
      }
    }
    return out;
  };

  // --- Vue -----------------------------------------------------------------------------------
  const vueElements = (vnode: unknown, depth: number, out: Element[]): void => {
    if (typeof vnode !== 'object' || vnode === null || depth > 20 || out.length >= 50) return;
    const node = vnode as { el?: unknown; component?: { subTree?: unknown } | null; children?: unknown };
    if (node.component?.subTree) {
      vueElements(node.component.subTree, depth + 1, out);
      return;
    }
    if (isElement(node.el)) {
      out.push(node.el);
      return;
    }
    if (Array.isArray(node.children)) for (const child of node.children) vueElements(child, depth + 1, out);
  };
  const vueName = (instance: VueInstance): string | null => {
    const type = instance.type;
    if (!type) return null;
    for (const candidate of [type.__name, type.name, type.displayName]) {
      if (typeof candidate === 'string' && candidate) return candidate;
    }
    if (typeof type.__file === 'string') {
      const base = type.__file.split(/[\\/]/).pop() ?? '';
      return base.replace(/\.\w+$/, '') || null;
    }
    return null;
  };
  const vueFile = (instance: VueInstance | null): Source | null => {
    const file = instance?.type?.__file;
    return typeof file === 'string' && file ? { file, line: null, column: null } : null;
  };

  const vue = (): ComponentEntry[] | null => {
    let node: Node | null = start;
    let instance: VueInstance | null = null;
    while (node && !instance) {
      const candidate = (node as unknown as { __vueParentComponent?: VueInstance }).__vueParentComponent;
      if (candidate) instance = candidate;
      else node = node.parentNode ?? (node as unknown as { host?: Node }).host ?? null;
    }
    if (!instance) return null;
    const out: ComponentEntry[] = [];
    for (let current: VueInstance | null = instance; current && out.length < limit * 4; current = current.parent) {
      const name = vueName(current);
      if (!name) continue;
      const elements: Element[] = [];
      vueElements(current.subTree, 0, elements);
      const definedAt = vueFile(current);
      const renderedAt = vueFile(current.parent);
      out.push({
        name,
        minified: isMinified(name),
        server: false,
        definedAt: definedAt && !isLibrary(definedAt.file) ? definedAt : null,
        renderedAt: renderedAt && !isLibrary(renderedAt.file) ? renderedAt : null,
        rect: unionRect(elements),
      });
    }
    return out;
  };

  const all = react() ?? vue() ?? [];
  const anySource = all.some((c) => c.definedAt ?? c.renderedAt);
  const user = anySource ? all.filter((c) => c.server || c.definedAt || c.renderedAt) : all;
  return user.slice(0, limit);
}
