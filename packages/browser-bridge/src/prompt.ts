import {
  formatSource,
  sourceTier,
  targetComponent,
  type AgentModeInclude,
  type ContentBlock,
  type FrameworkInfo,
  type ResolvedComponent,
  type ResolvedSource,
  type SourceCandidate,
  type SourceTier,
} from '@arbora/shared';

export interface PromptScreenshot {
  /** Absolute path of the outlined PNG/JPEG in `.arbora/screenshots/`. */
  readonly path: string;
  readonly relative: string;
  readonly uri: string;
  readonly mimeType: string;
  /** Base64 image data; sent as an `image` block only when the agent accepts images. */
  readonly data: string;
}

export interface PromptInput {
  readonly request: string;
  readonly url: string;
  readonly framework: FrameworkInfo;
  readonly components: readonly ResolvedComponent[];
  readonly targetIndex: number;
  readonly selector: string;
  readonly element: {
    readonly tag: string;
    readonly html: string;
    readonly text: string;
    readonly styles: Readonly<Record<string, string>>;
  };
  readonly candidates: readonly SourceCandidate[];
  readonly consoleErrors: readonly string[];
  readonly notes: readonly string[];
  readonly include: AgentModeInclude;
  readonly screenshot: PromptScreenshot | null;
  /** From the agent's `promptCapabilities.image`. */
  readonly imageSupported: boolean;
  readonly toUri: (path: string) => string;
}

export interface ComposedPrompt {
  readonly blocks: ContentBlock[];
  readonly tier: SourceTier;
}

const TIER_TEXT: Readonly<Record<SourceTier, string>> = {
  1: 'tier 1: exact file and line (framework debug info or data-arbora-src)',
  2: 'tier 2: source file known, line not known',
  3: 'tier 3: no source location from the framework; search the project (candidates below)',
};

const FRAMEWORK_TEXT: Readonly<Record<FrameworkInfo['id'], string>> = {
  react: 'React',
  vue: 'Vue',
  next: 'Next.js (React)',
  nuxt: 'Nuxt (Vue)',
  svelte: 'Svelte',
  angular: 'Angular',
  html: 'plain HTML (no framework detected)',
};

const MAX_CONSOLE_ERRORS = 10;

function componentLabel(component: ResolvedComponent): string {
  if (component.minified) return 'anonymous component';
  return component.server ? `${component.name} (server component)` : component.name;
}

function frameworkText(framework: FrameworkInfo): string {
  const base = FRAMEWORK_TEXT[framework.id];
  return framework.reactVersion ? `${base} ${framework.reactVersion}` : base;
}

/** Files the agent should open: the target's own sources first, then the rest of the chain. */
function knownFiles(components: readonly ResolvedComponent[], target: ResolvedComponent | null): ResolvedSource[] {
  const ordered = target ? [target, ...components.filter((c) => c !== target)] : [...components];
  const seen = new Set<string>();
  const out: ResolvedSource[] = [];
  for (const component of ordered) {
    for (const source of [component.definedIn, component.renderedIn]) {
      if (source && !seen.has(source.path)) {
        seen.add(source.path);
        out.push(source);
      }
    }
  }
  return out.slice(0, 5);
}

function fence(language: string, body: string): string {
  const ticks = body.includes('```') ? '````' : '```';
  return `${ticks}${language}\n${body}\n${ticks}`;
}

/**
 * Builds agent mode's prompt: a deterministic Markdown body (Request, Target, Context,
 * Instructions), the outlined screenshot as an `image` block (or a file link when the agent does
 * not take images), and `resource_link`s for the known source files or grep candidates.
 */
export function composePrompt(input: PromptInput): ComposedPrompt {
  const target = targetComponent(input, input.targetIndex);
  const tier = sourceTier(target);
  const files = knownFiles(input.components, target);
  const lines: string[] = [];

  lines.push('## Request', '', input.request.trim(), '');

  lines.push('## Target', '');
  lines.push(`- Page: ${input.url}`);
  lines.push(`- Framework: ${frameworkText(input.framework)}`);
  lines.push(`- Source: ${TIER_TEXT[tier]}`);
  if (input.components.length > 0) {
    lines.push(`- Component chain (nearest first): ${input.components.map(componentLabel).join(' ← ')}`);
  }
  if (target) {
    lines.push(`- Selected component: ${componentLabel(target)}`);
    if (target.renderedIn) lines.push(`  - Rendered at: ${formatSource(target.renderedIn)}`);
    if (target.definedIn) lines.push(`  - Defined in: ${formatSource(target.definedIn)}`);
  }
  lines.push(`- Element: \`<${input.element.tag}>\`, CSS selector \`${input.selector}\``);
  if (input.element.text) lines.push(`- Element text: "${input.element.text}"`);
  for (const note of input.notes) lines.push(`- Note: ${note}`);
  if (input.include.screenshot && input.screenshot) {
    lines.push(
      input.imageSupported
        ? '- Screenshot: attached; the selected element is outlined in red.'
        : `- Screenshot (selected element outlined in red): ${input.screenshot.relative}. Open it if you can read images.`,
    );
  }
  lines.push('');

  if (input.include.context) {
    lines.push('## Context', '');
    lines.push('Element HTML (trimmed):', '', fence('html', input.element.html), '');
    const styles = Object.entries(input.element.styles);
    if (styles.length > 0) {
      lines.push('Computed styles:', '', fence('css', styles.map(([k, v]) => `${k}: ${v};`).join('\n')), '');
    }
    const errors = input.consoleErrors.slice(-MAX_CONSOLE_ERRORS);
    if (errors.length > 0) {
      lines.push('Console errors since the last navigation:', '', ...errors.map((e) => `- ${e}`), '');
    }
  }

  if (input.include.sources) {
    if (tier === 3 && input.candidates.length > 0) {
      lines.push('## Candidate files', '', 'Found by searching the project for the component and class names:', '');
      for (const c of input.candidates) lines.push(`- ${c.relative} (matched: ${c.matched.join(', ')})`);
      lines.push('');
    } else if (files.length > 0) {
      lines.push('## Source files', '', ...files.map((f) => `- ${formatSource(f)}`), '');
    }
  }

  lines.push('## Instructions', '');
  lines.push(
    tier === 3
      ? '1. Find the source of the selected element (start with the candidate files and the component names), then edit it. Do not edit build output.'
      : '1. Edit the source file(s) above to make the change. Do not edit build output.',
  );
  lines.push('2. The dev server hot-reloads; wait for the change to apply before checking.');
  lines.push(
    "3. Verify in the browser: if you have Arbora's browser tools (`browser_screenshot`, `browser_snapshot`), use them; otherwise say what the user should check.",
  );
  lines.push('4. Reply with a short summary of what you changed and in which files.');

  const blocks: ContentBlock[] = [{ type: 'text', text: lines.join('\n') }];
  if (input.include.screenshot && input.screenshot) {
    const shot = input.screenshot;
    blocks.push(
      input.imageSupported
        ? { type: 'image', data: shot.data, mimeType: shot.mimeType, uri: shot.uri }
        : {
            type: 'resource_link',
            uri: shot.uri,
            name: shot.relative.split('/').pop() ?? shot.relative,
            mimeType: shot.mimeType,
          },
    );
  }
  if (input.include.sources) {
    const links = tier === 3 && input.candidates.length > 0 ? input.candidates : files;
    for (const file of links) {
      blocks.push({ type: 'resource_link', uri: input.toUri(file.path), name: file.relative });
    }
  }
  return { blocks, tier };
}
