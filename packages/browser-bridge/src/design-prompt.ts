import {
  DESIGN_INSTRUCTION,
  formatSource,
  stylingNote,
  type ContentBlock,
  type DesignOp,
  type FrameworkInfo,
  type ResolvedSource,
  type StylingApproach,
} from '@arbora/shared';
import type { PromptScreenshot } from './prompt.js';

export interface DesignPromptInput {
  readonly url: string;
  readonly framework: FrameworkInfo;
  readonly approach: StylingApproach;
  readonly changes: string;
  readonly sources: readonly ResolvedSource[];
  readonly before: PromptScreenshot;
  readonly after: PromptScreenshot;
  readonly imageSupported: boolean;
  readonly toUri: (path: string) => string;
}

const FRAMEWORK_TEXT: Readonly<Record<FrameworkInfo['id'], string>> = {
  react: 'React',
  vue: 'Vue',
  next: 'Next.js (React)',
  nuxt: 'Nuxt (Vue)',
  svelte: 'Svelte',
  angular: 'Angular',
  html: 'plain HTML (no framework detected)',
};

function imageBlock(shot: PromptScreenshot, imageSupported: boolean): ContentBlock {
  if (imageSupported) return { type: 'image', data: shot.data, mimeType: shot.mimeType, uri: shot.uri };
  return {
    type: 'resource_link',
    uri: shot.uri,
    name: shot.relative.split('/').pop() ?? shot.relative,
    mimeType: shot.mimeType,
  };
}

/**
 * The design-mode save prompt: the change list, the styling approach, resolved sources, and the
 * before/after screenshots. The live DOM has already been reverted, so the agent compares the
 * running page with the after screenshot.
 */
export function composeDesignPrompt(input: DesignPromptInput): ContentBlock[] {
  const framework = FRAMEWORK_TEXT[input.framework.id];
  const lines = [
    '## Request',
    '',
    DESIGN_INSTRUCTION,
    '',
    '## Page',
    '',
    `- URL: ${input.url}`,
    `- Framework: ${input.framework.reactVersion ? `${framework} ${input.framework.reactVersion}` : framework}`,
    `- Styling: ${input.approach}`,
    `- ${stylingNote(input.approach)}`,
    input.imageSupported
      ? '- Screenshots: before and after are attached, in that order.'
      : `- Before: ${input.before.relative}. After: ${input.after.relative}. Open them if you can read images.`,
    '',
    '## Changes',
    '',
    input.changes,
    '',
  ];
  if (input.sources.length > 0) {
    lines.push('## Sources', '', ...input.sources.map((source) => `- ${formatSource(source)}`), '');
  }
  lines.push(
    '## Instructions',
    '',
    `1. ${DESIGN_INSTRUCTION.charAt(0).toUpperCase()}${DESIGN_INSTRUCTION.slice(1)}.`,
    '2. Edit the source files above. Do not edit build output, and do not leave the inline styles the preview used.',
    '3. The dev server hot-reloads; wait for it, then verify with `browser_screenshot` and compare it to the after screenshot.',
    '4. Reply with a short summary of what you changed and in which files.',
  );
  const blocks: ContentBlock[] = [
    { type: 'text', text: lines.join('\n') },
    imageBlock(input.before, input.imageSupported),
    imageBlock(input.after, input.imageSupported),
  ];
  for (const source of input.sources) {
    blocks.push({ type: 'resource_link', uri: input.toUri(source.path), name: source.relative });
  }
  return blocks;
}

/** Ops that are currently applied (the change list does not include undone ones). */
export function appliedOps(ops: readonly DesignOp[], cursor: number): DesignOp[] {
  return ops.slice(0, cursor);
}
