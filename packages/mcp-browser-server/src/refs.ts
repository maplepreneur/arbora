import { ToolError, type Cdp } from './cdp.js';

/** How a tool names an element: a `ref` from the last `browser_snapshot`, or a CSS selector. */
export interface ElementTarget {
  readonly ref?: string | undefined;
  readonly selector?: string | undefined;
}

/** The refs of the last snapshot; a new snapshot replaces them all. */
export class RefTable {
  private refs: ReadonlyMap<string, number> = new Map();
  private generation = 0;

  replace(refs: ReadonlyMap<string, number>): void {
    this.refs = refs;
    this.generation++;
  }

  get(ref: string): number | undefined {
    return this.refs.get(ref);
  }

  get hasSnapshot(): boolean {
    return this.generation > 0;
  }
}

function backendIdOf(described: unknown): number | undefined {
  const node = (described as { node?: { backendNodeId?: unknown } } | null)?.node;
  return typeof node?.backendNodeId === 'number' ? node.backendNodeId : undefined;
}

/**
 * Resolves a tool's element target to a CDP `backendNodeId`. Refs are checked against the live
 * DOM (`DOM.describeNode`), so a ref from before a navigation or re-render fails with a hint to
 * take a new snapshot instead of acting on the wrong node.
 */
export async function resolveElement(cdp: Cdp, refs: RefTable, target: ElementTarget): Promise<number> {
  if (target.ref) {
    const ref = target.ref.replace(/^ref=/, '');
    const backendNodeId = refs.get(ref);
    if (backendNodeId === undefined) {
      throw new ToolError(
        refs.hasSnapshot
          ? `Unknown ref ${ref}; take a new browser_snapshot and use one of its refs.`
          : `No snapshot yet; call browser_snapshot first and use one of its refs.`,
      );
    }
    try {
      const described = await cdp.send('DOM.describeNode', { backendNodeId });
      if (backendIdOf(described) === undefined) throw new Error('gone');
    } catch {
      throw new ToolError(`Ref ${ref} is no longer in the page (it re-rendered or navigated); take a new snapshot.`);
    }
    return backendNodeId;
  }
  if (target.selector) {
    const document = (await cdp.send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
    let nodeId: number;
    try {
      ({ nodeId } = (await cdp.send('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: target.selector,
      })) as { nodeId: number });
    } catch (error) {
      throw new ToolError(`Invalid selector ${target.selector}: ${(error as Error).message}`);
    }
    if (!nodeId) throw new ToolError(`No element matches ${target.selector}`);
    const backendNodeId = backendIdOf(await cdp.send('DOM.describeNode', { nodeId }));
    if (backendNodeId === undefined) throw new ToolError(`No element matches ${target.selector}`);
    return backendNodeId;
  }
  throw new ToolError('Pass a ref (from browser_snapshot) or a CSS selector.');
}

/** Runs `fn` with the element as `this` in the page's main world and returns its JSON result. */
export async function callOnElement<T>(
  cdp: Cdp,
  backendNodeId: number,
  functionDeclaration: string,
  args: readonly unknown[] = [],
): Promise<T> {
  const { object } = (await cdp.send('DOM.resolveNode', { backendNodeId })) as { object: { objectId?: string } };
  if (!object.objectId) throw new ToolError('The element is not reachable from script');
  try {
    const result = (await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value?: unknown }; exceptionDetails?: { exception?: { description?: string }; text?: string } };
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new ToolError(detail.exception?.description ?? detail.text ?? 'The page threw an error');
    }
    return result.result.value as T;
  } finally {
    void cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
  }
}
