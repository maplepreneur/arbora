import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Image as ImageIcon, Paperclip, Send, Square, X } from 'lucide-react';
import type { Attachment, AvailableCommand, ThreadSummary } from '@arbora/shared';
import { showToast } from '../../store';
import { addAttachments, cancelTurn, removeAttachment, sendPrompt, setDraft, useAgents } from '../../agent-store';

/** The slash command being typed at the start of the composer, if any. */
export function slashQuery(text: string, caret: number): string | null {
  const head = text.slice(0, caret);
  const match = /^\/([\w-]*)$/.exec(head);
  return match ? (match[1] ?? '') : null;
}

export function matchCommands(commands: readonly AvailableCommand[], query: string): AvailableCommand[] {
  const lower = query.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(lower)).slice(0, 8);
}

/** Stable fallback: a fresh `[]` per render would make the store selector loop forever. */
const NO_ATTACHMENTS: readonly Attachment[] = [];

export function Composer({ thread, projectPath }: { thread: ThreadSummary; projectPath: string }) {
  const draft = useAgents((s) => s.drafts[thread.id] ?? '');
  const attachments = useAgents((s) => s.attachments[thread.id] ?? NO_ATTACHMENTS);
  const focusRequest = useAgents((s) => s.composerFocusRequest);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  // The highlighted suggestion is tied to the query it was chosen for, so a new query resets it.
  const [selection, setSelection] = useState<{ query: string | null; index: number }>({ query: null, index: 0 });
  const [dragging, setDragging] = useState(false);

  const status = thread.state.status;
  const busy = status === 'prompting';
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy && status !== 'starting';
  const query = slashQuery(draft, caret);
  const suggestions = useMemo(
    () => (query === null ? [] : matchCommands(thread.state.availableCommands, query)),
    [query, thread.state.availableCommands],
  );
  const selected = selection.query === query ? Math.min(selection.index, Math.max(0, suggestions.length - 1)) : 0;
  const setSelected = (update: (current: number) => number): void => setSelection({ query, index: update(selected) });

  useEffect(() => {
    textarea.current?.focus();
  }, [focusRequest, thread.id]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [draft]);

  const accept = (command: AvailableCommand): void => {
    const rest = draft.slice(caret);
    const next = `/${command.name} ${rest.replace(/^\s+/, '')}`;
    setDraft(thread.id, next);
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      const position = command.name.length + 2;
      el.setSelectionRange(position, position);
      setCaret(position);
    });
  };

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const result = await sendPrompt(thread.id);
    if (result.error && result.error !== 'auth_required') showToast(result.error);
  };

  const pick = async (): Promise<void> => {
    const picked = await window.arbora.invoke('agent.pickAttachments');
    if (picked.length > 0) addAttachments(thread.id, picked);
  };

  const onDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault();
    setDragging(false);
    const paths = [...event.dataTransfer.files]
      .map((file) => window.arbora.getPathForFile(file))
      .filter((path): path is string => Boolean(path));
    if (paths.length === 0) return;
    const described = await window.arbora.invoke('agent.describeAttachments', { paths });
    addAttachments(thread.id, described);
  };

  return (
    <div
      className={clsx('shrink-0 border-t border-border p-2', dragging && 'bg-accent-soft')}
      data-testid="composer"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => void onDrop(event)}
    >
      {attachments.length > 0 && (
        <ul className="mb-1.5 flex flex-wrap gap-1" data-testid="composer-attachments">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.path}
              attachment={attachment}
              projectPath={projectPath}
              onRemove={() => removeAttachment(thread.id, attachment.path)}
            />
          ))}
        </ul>
      )}
      <div className="relative">
        {suggestions.length > 0 && (
          <ul
            className="absolute right-0 bottom-full left-0 mb-1 overflow-hidden rounded border border-border bg-bg-elevated shadow-lg"
            data-testid="slash-suggestions"
            role="listbox"
          >
            {suggestions.map((command, index) => (
              <li
                key={command.name}
                role="option"
                aria-selected={index === selected}
                className={clsx(
                  'flex cursor-pointer items-baseline gap-2 px-2 py-1 text-[12px]',
                  index === selected && 'bg-bg-muted',
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  accept(command);
                }}
                onMouseEnter={() => setSelected(() => index)}
              >
                <span className="font-mono">/{command.name}</span>
                {command.input?.hint && <span className="font-mono text-fg-subtle">{command.input.hint}</span>}
                <span className="ml-auto truncate text-[11px] text-fg-subtle">{command.description}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textarea}
          value={draft}
          rows={1}
          data-testid="composer-input"
          placeholder={
            status === 'auth_required'
              ? 'Log in first (see above)'
              : status === 'starting'
                ? 'Starting the agent…'
                : thread.state.availableCommands.length > 0
                  ? 'Message the agent… ( / for commands)'
                  : 'Message the agent…'
          }
          className="max-h-[200px] w-full resize-none rounded border border-border bg-bg px-2 py-1.5 pr-16 text-[12.5px] outline-none select-text focus:border-accent"
          onChange={(event) => {
            setDraft(thread.id, event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (suggestions.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((s) => (s + 1) % suggestions.length);
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((s) => (s - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
                const command = suggestions[selected];
                if (command) {
                  event.preventDefault();
                  accept(command);
                  return;
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                setDraft(thread.id, draft.replace(/^\//, ''));
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5">
          <button
            type="button"
            title="Attach files"
            aria-label="Attach files"
            data-testid="composer-attach"
            onClick={() => void pick()}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-bg-muted hover:text-fg"
          >
            <Paperclip size={13} />
          </button>
          {busy ? (
            <button
              type="button"
              title="Stop"
              aria-label="Stop the agent"
              data-testid="composer-cancel"
              onClick={() => void cancelTurn(thread.id)}
              className="flex h-6 w-6 items-center justify-center rounded bg-danger/90 text-white hover:bg-danger"
            >
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              title="Send (Enter)"
              aria-label="Send"
              data-testid="composer-send"
              disabled={!canSend}
              onClick={() => void submit()}
              className="flex h-6 w-6 items-center justify-center rounded bg-accent text-accent-fg disabled:opacity-40"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({
  attachment,
  projectPath,
  onRemove,
}: {
  attachment: Attachment;
  projectPath: string;
  onRemove: () => void;
}) {
  const label = attachment.path.startsWith(projectPath)
    ? attachment.path.slice(projectPath.length + 1)
    : attachment.name;
  return (
    <li
      className="flex max-w-full items-center gap-1 rounded border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px]"
      title={attachment.path}
      data-testid="attachment-chip"
    >
      {attachment.kind === 'image' ? (
        <ImageIcon size={11} className="shrink-0" />
      ) : (
        <Paperclip size={11} className="shrink-0" />
      )}
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${attachment.name}`}
        onClick={onRemove}
        className="text-fg-subtle hover:text-fg"
      >
        <X size={11} />
      </button>
    </li>
  );
}
