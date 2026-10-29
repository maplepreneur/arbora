import { SquareTerminal } from 'lucide-react';
import { useApp } from '../store';

/**
 * Stage 2 replaces this with xterm. The focus tracking is real already: while it is focused, plain
 * `Ctrl+<key>` chords (Ctrl+K kill line, Ctrl+D EOF) pass through to the shell when the
 * `terminalPassthrough` setting is on.
 */
export default function TerminalPanel() {
  const passthrough = useApp((s) => s.settings.terminalPassthrough);
  return (
    <div
      role="textbox"
      aria-label="Terminal (placeholder)"
      aria-readonly
      tabIndex={0}
      data-testid="terminal-placeholder"
      onFocus={() => useApp.setState({ terminalFocused: true })}
      onBlur={() => useApp.setState({ terminalFocused: false })}
      className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center font-mono text-xs text-fg-subtle outline-none focus-visible:bg-bg-subtle"
    >
      <SquareTerminal size={22} strokeWidth={1.5} />
      <div className="font-sans font-medium text-fg-muted">Terminal</div>
      <div className="font-sans">Arrives in Stage 2</div>
      <div className="font-sans">Ctrl-key passthrough when focused: {passthrough ? 'on' : 'off'}</div>
    </div>
  );
}
