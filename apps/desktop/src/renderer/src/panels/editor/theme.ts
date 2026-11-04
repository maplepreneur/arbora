import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** Chrome colours come from the app's CSS variables, so light and dark follow the app theme. */
export const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--syn-selection)' },
  '.cm-activeLine': { backgroundColor: 'var(--syn-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--syn-active-line)', color: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-subtle)', border: 'none' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-muted)', border: 'none', color: 'var(--fg-muted)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft)',
    outline: '1px solid var(--accent)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--syn-search)', outline: '1px solid var(--syn-search-outline)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--syn-search-outline)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--syn-selection-match)' },
  '.cm-panels': { backgroundColor: 'var(--bg-subtle)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel input, .cm-panel button': { fontSize: '12px' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--bg-muted)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    color: 'var(--fg)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    color: 'var(--fg)',
    borderRadius: '6px',
  },
  '.cm-tooltip-lint': { maxWidth: '520px' },
  '.cm-diagnostic': { whiteSpace: 'pre-wrap', fontSize: '12px' },
  // Merge view (diff viewer): tinted lines and darker changed words. The merge view's base theme
  // underlines every changed character with a `background` gradient, so `background` replaces it.
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'var(--syn-diff-deleted)' },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: 'var(--syn-diff-line)' },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'var(--syn-diff-deleted-word) !important',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-changedText, .cm-inlineChangedLine .cm-changedText': {
    background: 'var(--syn-diff-word) !important',
    borderRadius: '2px',
  },
  '.cm-insertedLine, .cm-deletedLine, .cm-deletedLine del': { textDecoration: 'none' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'var(--syn-diff-deleted-gutter) !important',
  },
  '&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter': {
    background: 'var(--syn-diff-gutter) !important',
  },
  // The base theme keys these on `&light`/`&dark`, and the app theme is neither, so it always
  // picked the light gradient.
  '.cm-collapsedLines': {
    background: 'var(--bg-muted) !important',
    color: 'var(--fg-muted) !important',
    borderBlock: '1px solid var(--border)',
    fontFamily: 'var(--font-sans)',
    fontSize: '11px',
  },
});

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--syn-type)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syn-tag)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--syn-property)' },
  { tag: [t.definition(t.variableName), t.variableName], color: 'var(--fg)' },
  { tag: [t.heading], color: 'var(--syn-keyword)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--syn-string)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.invalid, color: 'var(--danger)' },
  { tag: [t.meta, t.processingInstruction], color: 'var(--fg-muted)' },
]);

export const editorHighlighting = syntaxHighlighting(highlightStyle);

export function fontSizeTheme(px: number) {
  return EditorView.theme({ '&': { fontSize: `${px}px` } });
}
