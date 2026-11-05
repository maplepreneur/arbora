import { showBrowserTab, showEditorTab, useFiles } from './files-store';
import { showRightView, useApp } from './store';
import { focusActiveTerminal, useTerminals } from './terminal-store';

/** One tab of the right column's strip, in the order the strip draws them. */
export type RightTab =
  | { readonly kind: 'browser' }
  | { readonly kind: 'terminal'; readonly tabId: string; readonly paneId: string }
  | { readonly kind: 'editor'; readonly id: string }
  | { readonly kind: 'changes' | 'problems' };

export function rightTabs(input: {
  readonly terminalTabs: readonly { readonly id: string; readonly panes: readonly string[] }[];
  readonly editorTabs: readonly { readonly id: string }[];
  readonly panels: readonly ('changes' | 'problems')[];
}): RightTab[] {
  return [
    { kind: 'browser' },
    ...input.terminalTabs.flatMap((tab): RightTab[] => {
      const paneId = tab.panes[0];
      return paneId ? [{ kind: 'terminal', tabId: tab.id, paneId }] : [];
    }),
    ...input.editorTabs.map((tab): RightTab => ({ kind: 'editor', id: tab.id })),
    ...input.panels.map((panel): RightTab => ({ kind: panel })),
  ];
}

/** The tab at `index` (`-1` is the last one), or null when there are fewer tabs. */
export function rightTabAt(tabs: readonly RightTab[], index: number): RightTab | null {
  return (index < 0 ? tabs.at(index) : tabs[index]) ?? null;
}

/** Shows tab `index` of the right column (`Mod+Alt+1`..`9`). Does nothing past the last tab. */
export function showRightTab(index: number): void {
  const tab = rightTabAt(
    rightTabs({
      terminalTabs: useTerminals.getState().tabs,
      editorTabs: useFiles.getState().tabs,
      panels: useApp.getState().layout.rightPanels,
    }),
    index,
  );
  if (!tab) return;
  switch (tab.kind) {
    case 'browser':
      showBrowserTab();
      return;
    case 'terminal':
      useTerminals.setState({ activeTabId: tab.tabId, activePaneId: tab.paneId });
      showRightView('terminal');
      focusActiveTerminal();
      return;
    case 'editor':
      showEditorTab(tab.id);
      return;
    case 'changes':
    case 'problems':
      showRightView(tab.kind);
      return;
    default: {
      const unreachable: never = tab;
      return unreachable;
    }
  }
}
