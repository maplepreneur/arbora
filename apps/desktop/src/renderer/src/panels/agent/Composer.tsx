import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Image as ImageIcon, Paperclip, Send, Square, X } from 'lucide-react';
import type { Attachment, ThreadSummary } from '@arbora/shared';
import { showToast } from '../../store';
import {
  addAttachments,
  isStoppable,
  removeAttachment,
  sendPrompt,
  setDraft,
  stopAgent,
  useAgents,
} from '../../agent-store';
import { pastedImageOnly } from './paste';

const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
]);

function isTextField(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Stable fallback: a fresh `[]` per render would make the store selector loop forever. */
const NO_ATTACHMENTS: readonly Attachment[] = [];
const MAX_COMPOSER_HEIGHT = 200;

export function Composer({
  thread,
  projectPath,
  name,
}: {
  thread: ThreadSummary;
  projectPath: string;
  /** Who the placeholder addresses ("Ask {name}…"); "the agent" when not given. */
  name?: string | undefined;
}) {
  const draft = useAgents((s) => s.drafts[thread.id] ?? '');
  const attachments = useAgents((s) => s.attachments[thread.id] ?? NO_ATTACHMENTS);
  const focusRequest = useAgents((s) => s.composerFocusRequest);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);

  const status = thread.state.status;
  const busy = status === 'working';
  const prompt = name ? `Ask ${name}…` : 'Message the agent…';
  const stoppable = isStoppable(status);
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy && status !== 'starting';

  const handledRequest = useRef(focusRequest);
  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const requested = handledRequest.current !== focusRequest;
    handledRequest.current = focusRequest;
    // Showing a thread focuses its composer, but not away from a field the user is typing in
    // (Grove's rename box opens together with the session it renames).
    const active = document.activeElement;
    // The Grove agent list keeps focus across a selection change (click or Arrow Up/Down).
    // An explicit focus request still moves here, including Next/Previous Agent.
    const inAgentList =
      active instanceof Element &&
      active.closest('[data-testid="grove-sessions"], [data-testid="grove-rail"]') !== null;
    if (requested || active === element || (!isTextField(active) && !inAgentList)) element.focus();
  }, [focusRequest, thread.id]);

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    // `scrollHeight` excludes the border, while the height (border-box) includes it; without the
    // border the box is always a few pixels short and shows a scrollbar.
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = '0px';
    const wanted = element.scrollHeight + border;
    element.style.height = `${Math.min(wanted, MAX_COMPOSER_HEIGHT)}px`;
    element.style.overflowY = wanted > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
  }, [draft]);

  const submit = async (): Promise<void> => {
    if (!canSend) return;
    const result = await sendPrompt(thread.id);
    if (result.error) showToast(result.error);
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

  const onPaste = (event: React.ClipboardEvent): void => {
    const data = event.clipboardData;
    const paths = [...data.files]
      .map((file) => window.arbora.getPathForFile(file))
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      event.preventDefault();
      void window.arbora
        .invoke('agent.describeAttachments', { paths })
        .then((described) => addAttachments(thread.id, described));
      return;
    }
    if (!pastedImageOnly([...data.items].map((item) => ({ kind: item.kind, type: item.type })))) return;
    event.preventDefault();
    void window.arbora
      .invoke('agent.pasteImage')
      .then((attachment) => {
        if (attachment) addAttachments(thread.id, [attachment]);
        else showToast('The clipboard has no image Arbora can read');
      })
      .catch((error: unknown) => showToast((error as Error).message));
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
        <textarea
          ref={textarea}
          value={draft}
          rows={1}
          data-testid="composer-input"
          placeholder={status === 'starting' ? 'Starting the agent…' : `${prompt} (or type in its terminal)`}
          className="block max-h-[200px] w-full resize-none overflow-y-hidden rounded border border-border bg-bg px-2 py-1.5 pr-16 agent-text outline-none select-text focus:border-accent"
          onChange={(event) => {
            setDraft(thread.id, event.target.value);
          }}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && stoppable) {
              event.preventDefault();
              void stopAgent(thread.id);
              return;
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
          {stoppable ? (
            <button
              type="button"
              title={busy ? 'Stop (Esc)' : 'Stop starting the agent (Esc)'}
              aria-label="Stop the agent"
              data-testid="composer-cancel"
              onClick={() => void stopAgent(thread.id)}
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
