const TRAILING_PARENS = /^(.*\S)\s*\(([^()]+)\)$/;
const CHORD = /^(?:[⌘⌥⇧⌃]+.+|(?:Ctrl|Alt|Shift|Cmd|Meta|Mod)\+.+|F\d{1,2})$/;

/** `"Switch project (Ctrl+Alt+O)"` → label and shortcut, so the tooltip can show the chord as a key. */
export function splitTooltip(text: string): { label: string; shortcut: string | null } {
  const match = TRAILING_PARENS.exec(text.trim());
  const label = match?.[1];
  const inner = match?.[2]?.trim();
  if (label && inner && CHORD.test(inner)) return { label, shortcut: inner };
  return { label: text, shortcut: null };
}
