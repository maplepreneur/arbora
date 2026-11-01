import { z } from 'zod';
import type { Platform } from './platform.js';
import type { UpdateChannel } from './settings.js';

/**
 * How this copy of Arbora can update itself. electron-updater replaces the app in place on macOS,
 * Windows (per-user NSIS) and AppImage. A `.deb`, the AUR package and the tarball are owned by the
 * package manager or the user, so those only get told that a new version exists.
 */
export const installKindSchema = z.enum(['dmg', 'nsis', 'appimage', 'deb', 'aur', 'tarball', 'dev']);
export type InstallKind = z.infer<typeof installKindSchema>;

export function canSelfUpdate(kind: InstallKind): boolean {
  switch (kind) {
    case 'dmg':
    case 'nsis':
    case 'appimage':
      return true;
    case 'deb':
    case 'aur':
    case 'tarball':
    case 'dev':
      return false;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

export interface InstallKindInput {
  readonly platform: Platform;
  readonly packaged: boolean;
  /** `process.env.APPIMAGE`, set by the AppImage runtime. */
  readonly appImage: string | undefined;
  /** Contents of `resources/package-type` (electron-builder writes `deb`, `rpm`, ...), if any. */
  readonly packageType: string | undefined;
  /** Absolute path of the executable. */
  readonly execPath: string;
}

export function detectInstallKind(input: InstallKindInput): InstallKind {
  if (!input.packaged) return 'dev';
  switch (input.platform) {
    case 'darwin':
      return 'dmg';
    case 'win32':
      return 'nsis';
    case 'linux':
      if (input.appImage) return 'appimage';
      // The AUR package installs the tarball under /opt/arbora (see aur/PKGBUILD).
      if (input.execPath.startsWith('/opt/arbora/')) return 'aur';
      if (input.packageType?.trim() === 'deb') return 'deb';
      return 'tarball';
    default: {
      const unreachable: never = input.platform;
      return unreachable;
    }
  }
}

/** What to tell users whose install cannot update itself. */
export function manualUpdateHint(kind: InstallKind, version: string): string {
  switch (kind) {
    case 'deb':
      return `Download the Arbora ${version} .deb from the release page and install it with \`sudo apt install ./<file>.deb\`.`;
    case 'aur':
      return 'Update the arbora-bin package with your AUR helper, for example `yay -Syu arbora-bin`.';
    case 'tarball':
      return `Download the Arbora ${version} .tar.gz from the release page and unpack it over this copy.`;
    case 'dev':
      return 'This is a development build. Pull the latest source instead.';
    case 'dmg':
    case 'nsis':
    case 'appimage':
      return 'Arbora downloads and installs this update itself.';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  readonly pre: readonly (string | number)[];
}

function parseVersion(raw: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(raw.trim());
  if (!match) return null;
  const pre = match[4] ? match[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre };
}

/** Semver precedence: negative when `a` is older, 0 when equal (or unparsable), positive when newer. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    if (typeof l === 'number' && typeof r === 'number') return l - r;
    if (typeof l === 'number') return -1;
    if (typeof r === 'number') return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/** `1.2.0-beta.3` is on `beta`; plain versions are on `latest`. */
export function versionChannel(version: string): UpdateChannel {
  return parseVersion(version)?.pre.length ? 'beta' : 'latest';
}

/** Whether `candidate` should be offered to someone on `current` who follows `channel`. */
export function isOfferedUpdate(current: string, candidate: string, channel: UpdateChannel): boolean {
  if (channel === 'latest' && versionChannel(candidate) === 'beta') return false;
  return compareVersions(candidate, current) > 0;
}

export const updateStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('checking') }),
  z.object({ status: z.literal('current'), checkedAt: z.number().int() }),
  z.object({
    status: z.literal('available'),
    version: z.string(),
    notes: z.string(),
    releaseUrl: z.string(),
    /** Set when this install cannot update itself. */
    manualHint: z.string().nullable(),
  }),
  z.object({ status: z.literal('downloading'), version: z.string(), percent: z.number().min(0).max(100) }),
  z.object({ status: z.literal('ready'), version: z.string(), notes: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
]);
export type UpdateState = z.infer<typeof updateStateSchema>;

export const UPDATE_REPOSITORY = { owner: 'maplepreneur', repo: 'arbora' } as const;

export function releasePageUrl(version: string): string {
  return `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.repo}/releases/tag/v${version.replace(/^v/, '')}`;
}

/** The fields of a GitHub Releases API entry that matter here. */
export interface GithubRelease {
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly body?: string | null;
  readonly html_url?: string;
}

/** The newest published release this channel should be offered, for installs that update by hand. */
export function pickRelease(
  releases: readonly GithubRelease[],
  current: string,
  channel: UpdateChannel,
): GithubRelease | null {
  let best: GithubRelease | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    if (channel === 'latest' && release.prerelease) continue;
    if (!isOfferedUpdate(current, release.tag_name, channel)) continue;
    if (!best || compareVersions(release.tag_name, best.tag_name) > 0) best = release;
  }
  return best;
}

/** Release notes from electron-updater are a string, a list per version, or HTML. */
export function releaseNotesText(notes: unknown): string {
  if (typeof notes === 'string') return stripHtml(notes);
  if (Array.isArray(notes)) {
    return notes
      .flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return [];
        const { version, note } = entry as { version?: unknown; note?: unknown };
        const text = typeof note === 'string' ? stripHtml(note) : '';
        return [`## ${typeof version === 'string' ? version : ''}\n\n${text}`.trim()];
      })
      .join('\n\n');
  }
  return '';
}

function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
