import { useEffect, useRef, useState } from 'react';
import { Columns2, Rows2 } from 'lucide-react';
import clsx from 'clsx';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import type { DiffTab } from '../../files-store';
import { useApp } from '../../store';
import { languageFor } from './languages';
import { editorHighlighting, editorTheme, fontSizeTheme } from './theme';

export type DiffLayout = 'split' | 'unified';

const COLLAPSE = { margin: 3, minSize: 4 } as const;

/** Each side of the split view sizes to its content; the merge view scrolls as a whole. */
const autoHeight = EditorView.theme({ '&': { height: 'auto' } });

/**
 * Read-only diff on CodeMirror's merge view: side by side or unified, word-level highlights, and
 * unchanged regions collapsed. Stage 8 opens git changes in it; agent edits open here today.
 */
export function DiffViewer({
  tab,
}: {
  tab: Pick<DiffTab, 'path' | 'left' | 'right' | 'leftLabel' | 'rightLabel' | 'title'>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<DiffLayout>('split');
  const size = useApp((s) => s.settings.editor.fontSize);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const shared: Extension[] = [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      lineNumbers(),
      editorTheme,
      editorHighlighting,
      fontSizeTheme(size),
      languageFor(tab.path),
    ];
    if (layout === 'split') {
      const merge = new MergeView({
        a: { doc: tab.left, extensions: [...shared, autoHeight] },
        b: { doc: tab.right, extensions: [...shared, autoHeight] },
        parent,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: COLLAPSE,
      });
      return () => merge.destroy();
    }
    const unified = new EditorView({
      parent,
      state: EditorState.create({
        doc: tab.right,
        extensions: [
          ...shared,
          unifiedMergeView({
            original: tab.left,
            highlightChanges: true,
            gutter: true,
            mergeControls: false,
            collapseUnchanged: COLLAPSE,
          }),
        ],
      }),
    });
    return () => unified.destroy();
  }, [tab.path, tab.left, tab.right, layout, size]);

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="diff-viewer" data-layout={layout}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="min-w-0 flex-1 truncate text-fg-muted" title={tab.path}>
          <span className="text-fg">{tab.leftLabel}</span> ↔ <span className="text-fg">{tab.rightLabel}</span>
        </span>
        {(['split', 'unified'] as const).map((id) => {
          const Icon = id === 'split' ? Columns2 : Rows2;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={layout === id}
              data-testid={`diff-layout-${id}`}
              title={id === 'split' ? 'Side by side' : 'Unified'}
              onClick={() => setLayout(id)}
              className={clsx(
                'flex h-6 w-6 items-center justify-center rounded',
                layout === id ? 'bg-bg-muted text-fg' : 'text-fg-subtle hover:bg-bg-muted hover:text-fg',
              )}
            >
              <Icon size={14} />
            </button>
          );
        })}
      </div>
      <div ref={host} className="arbora-diff min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
