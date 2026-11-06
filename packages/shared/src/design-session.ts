import { z } from 'zod';
import { stylingApproachSchema, type StylingApproach } from './design.js';

/** A saved design session, reduced to what the history list, compare view and Markdown export show. */
export interface DesignSessionDocument {
  readonly createdAt: string;
  readonly url: string;
  readonly approach: StylingApproach;
  readonly opCount: number;
  readonly changes: string;
  readonly framework: string | null;
  readonly sources: readonly { readonly relative: string; readonly line: number | null }[];
  /** Project-relative screenshot paths, when the files sit inside the project. */
  readonly beforeRelative: string | null;
  readonly afterRelative: string | null;
}

const sessionSourceSchema = z.object({
  relative: z.string().max(2000),
  line: z.number().int().nullable(),
});

/** What Compare loads: the Markdown document plus the two screenshots, when they can be read. */
export const designSessionDetailSchema = z.object({
  id: z.string().max(80),
  createdAt: z.string().max(40),
  url: z.string().max(4000),
  approach: stylingApproachSchema,
  opCount: z.number().int(),
  changes: z.string().max(200_000),
  markdown: z.string().max(250_000),
  sources: z.array(sessionSourceSchema).max(8),
  /** `data:` URL, or null when the file is missing, outside the project, or too large. */
  beforeUrl: z.string().max(2_800_000).nullable(),
  afterUrl: z.string().max(2_800_000).nullable(),
});
export type DesignSessionDetail = z.infer<typeof designSessionDetailSchema>;

function sourceLabel(source: { relative: string; line: number | null }): string {
  return source.line === null ? source.relative : `${source.relative}:${source.line}`;
}

/**
 * One Markdown document for a saved design session: when and where, the sources, the change list
 * the agent was given, and the before/after screenshot paths.
 */
export function renderSessionMarkdown(session: DesignSessionDocument): string {
  const sources =
    session.sources.length > 0
      ? session.sources.map((source) => `- \`${sourceLabel(source)}\``).join('\n')
      : '- none recorded';
  const shots = [
    session.beforeRelative ? `- Before: \`${session.beforeRelative}\`` : null,
    session.afterRelative ? `- After: \`${session.afterRelative}\`` : null,
  ].filter((line) => line !== null);
  const framework = session.framework ? `\n- Framework: ${session.framework}` : '';
  return [
    '# Design session',
    '',
    `- When: ${session.createdAt}`,
    `- Page: ${session.url}`,
    `- Styling: ${session.approach}`,
    `- Changes: ${session.opCount}${framework}`,
    '',
    '## Sources',
    '',
    sources,
    '',
    '## Changes',
    '',
    session.changes.trim() || '_No changes._',
    '',
    '## Screenshots',
    '',
    shots.length > 0 ? shots.join('\n') : '- none recorded',
    '',
  ].join('\n');
}
