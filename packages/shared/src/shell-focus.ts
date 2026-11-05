/** Shell columns `Ctrl+Alt+Left` / `Right` move between. */
export const SHELL_FOCUS_PANES = ['tree', 'agent', 'center', 'sidebar'] as const;
export type ShellFocusPane = (typeof SHELL_FOCUS_PANES)[number];

/**
 * The native page can take the keyboard only while it is actually on screen.
 * An error or an empty tab parks the `WebContentsView`. Focusing that view
 * swallows chords, because a hidden view keeps keyboard focus and does not
 * deliver `before-input-event`. The content pane's own DOM is the target then,
 * and it still counts as the content pane.
 */
export function browserViewAcceptsFocus(
  state: { readonly url: string; readonly error: unknown } | null | undefined,
): boolean {
  return Boolean(state?.url) && state?.error == null;
}

export interface ContentPaneFocusInput {
  /** `data-landmark` of the focused element, or null when focus is on `body` or another web contents. */
  readonly landmark: string | null;
  readonly terminalFocused: boolean;
  /** The live page `WebContentsView` has the keyboard. Never true for an error or empty tab. */
  readonly pageFocused: boolean;
  /**
   * The renderer document has focus. A click in the chat arrives before the page-blur event, so a
   * stale `pageFocused` must not keep the content pane while the DOM already holds the keyboard.
   */
  readonly documentFocused?: boolean;
  readonly sticky: boolean;
}

export interface ContentPaneFocusDecision {
  /** `Mod+1`..`9` switch content-pane tabs only while this is true. */
  readonly contentFocused: boolean;
  readonly sticky: boolean;
}

/**
 * Whether the content pane owns `Mod+1`..`9`. A focused error or empty browser is
 * landmark `center` (renderer DOM). A loaded page is `pageFocused` instead, because
 * the native view is not a DOM node. The project tree and the chat clear the sticky
 * bit; the side column does not.
 */
export function nextContentPaneFocus(input: ContentPaneFocusInput): ContentPaneFocusDecision {
  if (input.pageFocused && input.documentFocused !== true) return { contentFocused: true, sticky: true };
  const inTree = input.landmark === 'tree';
  const inChat = input.landmark === 'agent';
  const inContent = input.landmark === 'center' || input.terminalFocused;
  let sticky = input.sticky;
  if (input.landmark !== null && (inTree || inChat)) sticky = false;
  else if (inContent) sticky = true;
  return { contentFocused: inContent || sticky, sticky };
}

/** The pane that should draw the keyboard-focus border. A live page wins over a stale DOM node. */
export function shellFocusPane(input: {
  readonly landmark: string | null;
  readonly terminalFocused: boolean;
  readonly pageFocused: boolean;
  readonly documentFocused?: boolean;
}): ShellFocusPane | null {
  if (input.pageFocused && input.documentFocused !== true) return 'center';
  switch (input.landmark) {
    case 'tree':
    case 'agent':
    case 'center':
    case 'sidebar':
      return input.landmark;
    default:
      return input.terminalFocused ? 'center' : null;
  }
}

export function isShellFocusPane(value: string | null | undefined): value is ShellFocusPane {
  return value === 'tree' || value === 'agent' || value === 'center' || value === 'sidebar';
}
