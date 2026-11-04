/** The mark Grove shows for a project folder. `arbora` is the fallback when nothing more specific matches. */
export const PROJECT_FRAMEWORKS = [
  'nuxt',
  'next',
  'sveltekit',
  'remix',
  'astro',
  'angular',
  'svelte',
  'vue',
  'react',
  'vite',
  'rails',
  'arbora',
] as const;

export type ProjectFramework = (typeof PROJECT_FRAMEWORKS)[number];

export interface ProjectFrameworkInput {
  /** `package.json` text. Dependencies and devDependencies are both read. */
  readonly packageJson?: string;
  /** `Gemfile` text. A `gem "rails"` line counts. */
  readonly gemfile?: string;
  /** `bin/rails` or `config/application.rb` is present. */
  readonly rails?: boolean;
}

const PACKAGE_FRAMEWORKS: readonly { readonly pkg: string; readonly framework: ProjectFramework }[] = [
  { pkg: 'nuxt', framework: 'nuxt' },
  { pkg: 'next', framework: 'next' },
  { pkg: '@sveltejs/kit', framework: 'sveltekit' },
  { pkg: '@remix-run/react', framework: 'remix' },
  { pkg: 'remix', framework: 'remix' },
  { pkg: 'astro', framework: 'astro' },
  { pkg: '@angular/core', framework: 'angular' },
  { pkg: 'svelte', framework: 'svelte' },
  { pkg: 'vue', framework: 'vue' },
  { pkg: 'react', framework: 'react' },
  { pkg: 'vite', framework: 'vite' },
];

/** First match wins. Nuxt beats Vue and Vite. Next beats React. Vite is only the app framework when nothing above matched. */
const PRIORITY: readonly ProjectFramework[] = [
  'nuxt',
  'next',
  'sveltekit',
  'remix',
  'astro',
  'angular',
  'svelte',
  'vue',
  'react',
  'vite',
  'rails',
];

function dependencyNames(packageJson: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(packageJson);
    if (parsed === null || typeof parsed !== 'object') return new Set();
    const body = parsed as { dependencies?: unknown; devDependencies?: unknown };
    const names = new Set<string>();
    for (const field of [body.dependencies, body.devDependencies]) {
      if (field === null || typeof field !== 'object') continue;
      for (const name of Object.keys(field)) names.add(name);
    }
    return names;
  } catch {
    return new Set();
  }
}

function gemfileHasRails(gemfile: string | undefined): boolean {
  if (!gemfile) return false;
  return /^\s*gem\s+['"]rails['"]/m.test(gemfile);
}

/**
 * The one framework logo a project row should show.
 * An empty folder, or one with no recognised manifest, is Arbora.
 */
export function detectProjectFramework(input: ProjectFrameworkInput): ProjectFramework {
  const names = input.packageJson ? dependencyNames(input.packageJson) : new Set<string>();
  const found = new Set<ProjectFramework>();
  for (const { pkg, framework } of PACKAGE_FRAMEWORKS) {
    if (names.has(pkg)) found.add(framework);
  }
  if (input.rails || gemfileHasRails(input.gemfile)) found.add('rails');
  for (const framework of PRIORITY) {
    if (found.has(framework)) return framework;
  }
  return 'arbora';
}
