/** Browser tools whose result is a step in the thread's action trace. Reads (snapshot, logs) are not. */
const TRACED_BROWSER_TOOLS = new Set([
  'browser_navigate',
  'browser_reload',
  'browser_back',
  'browser_forward',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_press_key',
  'browser_scroll',
  'browser_select_option',
  'browser_wait_for',
  'browser_evaluate',
  'browser_set_viewport',
  'browser_screenshot',
  'browser_compare',
  'devserver_restart',
]);

export function isTracedBrowserTool(name: string): boolean {
  return TRACED_BROWSER_TOOLS.has(name);
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function targetOf(args: Record<string, unknown>): string {
  if (typeof args.ref === 'string' && args.ref) return args.ref;
  if (typeof args.selector === 'string' && args.selector) return args.selector;
  return 'element';
}

/** A short label for one traced tool call, shown as the step title. */
export function actionTraceTitle(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'browser_navigate':
      return `Navigate ${clip(typeof args.url === 'string' ? args.url : '', 72)}`;
    case 'browser_reload':
      return args.hard === true ? 'Hard reload' : 'Reload';
    case 'browser_back':
      return 'Back';
    case 'browser_forward':
      return 'Forward';
    case 'browser_click': {
      const times = args.double === true ? ' twice' : '';
      const button = args.button === 'right' || args.button === 'middle' ? ` (${args.button})` : '';
      return `Click ${targetOf(args)}${times}${button}`;
    }
    case 'browser_hover':
      return `Hover ${targetOf(args)}`;
    case 'browser_type':
      return `Type ${clip(typeof args.text === 'string' ? args.text : '', 40)}`;
    case 'browser_press_key':
      return `Press ${clip(typeof args.key === 'string' ? args.key : '', 40)}`;
    case 'browser_scroll': {
      const dx = typeof args.dx === 'number' ? args.dx : 0;
      const dy = typeof args.dy === 'number' ? args.dy : 0;
      return `Scroll ${dx}, ${dy}`;
    }
    case 'browser_select_option': {
      const values = Array.isArray(args.values)
        ? args.values.filter((value) => typeof value === 'string').join(', ')
        : '';
      return `Select ${clip(values, 40)}`;
    }
    case 'browser_wait_for':
      return 'Wait';
    case 'browser_evaluate':
      return `Evaluate ${clip(typeof args.expression === 'string' ? args.expression : '', 40)}`;
    case 'browser_set_viewport': {
      if (typeof args.preset === 'string') return `Viewport ${args.preset}`;
      const width = typeof args.width === 'number' ? String(args.width) : '?';
      const height = typeof args.height === 'number' ? String(args.height) : '?';
      return `Viewport ${width}×${height}`;
    }
    case 'browser_screenshot':
      return `Screenshot ${typeof args.mode === 'string' ? args.mode : 'viewport'}`;
    case 'browser_compare':
      return 'Compare tabs';
    case 'devserver_restart':
      return 'Restart dev server';
    default:
      return tool;
  }
}

/** Title for a compare result, including the score. Null when the text is not a compare payload. */
export function compareScoreTitle(resultText: string): string | null {
  try {
    const parsed = JSON.parse(resultText) as { score?: unknown };
    if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) return null;
    return `Matching design · ${parsed.score.toFixed(2)}`;
  } catch {
    return null;
  }
}

/** Project-relative path of a saved compare image. Null when the result did not save one. */
export function compareSavedPath(resultText: string): string | null {
  try {
    const parsed = JSON.parse(resultText) as { saved?: unknown };
    if (typeof parsed.saved !== 'string' || !parsed.saved.startsWith('.arbora/screenshots/')) return null;
    return parsed.saved;
  } catch {
    return null;
  }
}
