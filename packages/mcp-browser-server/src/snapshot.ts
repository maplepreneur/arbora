/** The subset of CDP's `Accessibility.AXNode` the snapshot uses. */
export interface AxNode {
  readonly nodeId: string;
  readonly ignored?: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly value?: { readonly value?: unknown };
  readonly properties?: readonly { readonly name: string; readonly value: { readonly value?: unknown } }[];
  readonly childIds?: readonly string[];
  readonly parentId?: string;
  readonly backendDOMNodeId?: number;
}

export interface SnapshotLimits {
  /** Lines printed before the snapshot is cut off. */
  readonly maxNodes: number;
  readonly maxDepth: number;
  /** Names and values longer than this are shortened. */
  readonly maxText: number;
}

export const SNAPSHOT_LIMITS: SnapshotLimits = { maxNodes: 10_000, maxDepth: 60, maxText: 200 };

export interface Snapshot {
  /** Playwright-MCP-style YAML: `- role "name" [attr] [ref=eN]`, children indented below. */
  readonly text: string;
  /** `eN` -> CDP `backendNodeId`, for the interaction tools. */
  readonly refs: ReadonlyMap<string, number>;
  readonly truncated: boolean;
  readonly nodeCount: number;
}

/** Roles that only group their children; unnamed ones are dropped and their children hoisted. */
const TRANSPARENT_ROLES = new Set(['generic', 'none', 'presentation', 'GenericContainer', 'Section', 'group']);
/** Never printed (their text is already in the parent's name or a StaticText sibling). */
const SKIPPED_ROLES = new Set(['InlineTextBox', 'LineBreak', 'ListMarker']);
const TEXT_ROLES = new Set(['StaticText', 'text']);
const ROOT_ROLES = new Set(['RootWebArea', 'WebArea']);
/** AX properties worth showing, in this order. */
const SHOWN_PROPERTIES = ['level', 'checked', 'pressed', 'selected', 'expanded', 'disabled', 'required', 'url'];

function stringOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

function propertyText(node: AxNode, maxText: number): string {
  const parts: string[] = [];
  for (const name of SHOWN_PROPERTIES) {
    const property = node.properties?.find((p) => p.name === name);
    if (!property) continue;
    const value = property.value.value;
    if (value === false || value === 'false' || value === undefined || value === '') continue;
    if (name === 'disabled' || name === 'required') parts.push(`[${name}]`);
    else if (value === true || value === 'true') parts.push(`[${name}]`);
    else parts.push(`[${name}=${shorten(stringOf(value), maxText)}]`);
  }
  return parts.join(' ');
}

/**
 * Flattens CDP's full accessibility tree into the compact text Playwright MCP produces, which agents
 * already know how to read. Ignored nodes and unnamed wrappers are dropped (their children move
 * up), text that repeats the parent's name is skipped, and every printed element gets a `ref`.
 */
export function formatSnapshot(nodes: readonly AxNode[], limits: SnapshotLimits = SNAPSHOT_LIMITS): Snapshot {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => !node.parentId || !byId.has(node.parentId));
  const lines: string[] = [];
  const refs = new Map<string, number>();
  let truncated = false;
  let nextRef = 1;

  const roleOf = (node: AxNode): string => stringOf(node.role?.value);
  const nameOf = (node: AxNode): string => stringOf(node.name?.value).trim();

  /** The nodes printed in place of `node`'s children (hoisting through dropped nodes). */
  const visibleChildren = (node: AxNode, depth: number): AxNode[] => {
    const out: AxNode[] = [];
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (!child) continue;
      const role = roleOf(child);
      if (SKIPPED_ROLES.has(role)) continue;
      const dropped = child.ignored === true || ROOT_ROLES.has(role) || (TRANSPARENT_ROLES.has(role) && !nameOf(child));
      if (dropped) {
        if (depth < limits.maxDepth) out.push(...visibleChildren(child, depth + 1));
      } else {
        out.push(child);
      }
    }
    return out;
  };

  const emit = (line: string): boolean => {
    if (lines.length >= limits.maxNodes) {
      truncated = true;
      return false;
    }
    lines.push(line);
    return true;
  };

  const isText = (node: AxNode): boolean => TEXT_ROLES.has(roleOf(node));

  /** Prints `nodes` at `indent`, joining adjacent text nodes (React splits `Hello, {name}` into several). */
  const walkAll = (nodes: readonly AxNode[], indent: number, depth: number, parentName: string): void => {
    let run = '';
    const flush = (): void => {
      const joined = run.replace(/\s+/g, ' ').trim();
      run = '';
      if (joined && joined !== parentName && !truncated) {
        emit(`${'  '.repeat(indent)}- text: ${quote(shorten(joined, limits.maxText))}`);
      }
    };
    for (const node of nodes) {
      if (isText(node)) {
        run += stringOf(node.name?.value);
        continue;
      }
      flush();
      walk(node, indent, depth);
    }
    flush();
  };

  const walk = (node: AxNode, indent: number, depth: number): void => {
    if (truncated) return;
    if (lines.length >= limits.maxNodes) {
      truncated = true;
      return;
    }
    const pad = '  '.repeat(indent);
    const role = roleOf(node);
    const name = nameOf(node);
    let children = visibleChildren(node, depth);
    // Text that only repeats the name (`button "Save"` > text "Save") adds nothing.
    if (children.length > 0 && children.every(isText)) {
      const text = children.map((c) => stringOf(c.name?.value)).join('');
      if (text.replace(/\s+/g, ' ').trim() === name) children = [];
    }
    const parts = [`${pad}- ${role || 'node'}`];
    if (name) parts.push(quote(shorten(name, limits.maxText)));
    const value = stringOf(node.value?.value);
    if (value) parts.push(`[value=${quote(shorten(value, limits.maxText))}]`);
    const properties = propertyText(node, limits.maxText);
    if (properties) parts.push(properties);
    if (node.backendDOMNodeId !== undefined) {
      const ref = `e${nextRef++}`;
      refs.set(ref, node.backendDOMNodeId);
      parts.push(`[ref=${ref}]`);
    }
    const tooDeep = depth >= limits.maxDepth && children.length > 0;
    if (tooDeep) truncated = true;
    if (!emit(parts.join(' ') + (children.length > 0 && !tooDeep ? ':' : ''))) return;
    if (tooDeep) return;
    walkAll(children, indent + 1, depth + 1, name);
  };

  if (root) {
    const top = ROOT_ROLES.has(roleOf(root)) || root.ignored === true ? visibleChildren(root, 0) : [root];
    walkAll(top, 0, 1, nameOf(root));
  }
  // `walk` sets the flag; TypeScript's narrowing cannot see assignments made in closures.
  if (truncated as boolean) {
    lines.push(`# Snapshot truncated at ${lines.length} lines; use browser_screenshot or a narrower page.`);
  }
  return { text: lines.join('\n'), refs, truncated, nodeCount: lines.length };
}
