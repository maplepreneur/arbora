import { z } from 'zod';
import type { Platform } from './platform.js';
import type { ReleaseChannel, UpdateChannel } from './settings.js';

/**
 * How this copy of Arbora can update itself. electron-updater replaces the app in place on macOS,
 * Windows (per-user NSIS) and AppImage. A `.deb`, the AUR package and the tarball are owned by the
 * package manager or the user, so those only get told that a new version exists.
 */
export const installKindSchema = z.enum(['dmg', 'nsis', 'appimage', 'deb', 'aur', 'tarball', 'dev']);
export type InstallKind = z.infer<typeof installKindSchema>;

/**
 * Whether this install can replace itself. macOS only installs updates for an app signed with a
 * Developer ID (Squirrel.Mac checks the signature), so an unsigned or ad-hoc signed `.dmg` build
 * updates by hand like a `.deb`. Unsigned Windows and AppImage builds update in place.
 */
export function canSelfUpdate(kind: InstallKind, macSigned = true): boolean {
  switch (kind) {
    case 'dmg':
      return macSigned;
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
      return `Download the Arbora ${version} .dmg from the release page and drag Arbora to Applications, replacing this copy.`;
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
export function versionChannel(version: string): ReleaseChannel {
  return parseVersion(version)?.pre.length ? 'beta' : 'latest';
}

/** Whether `candidate` should be offered to someone on `current` who follows `channel`. */
export function isOfferedUpdate(current: string, candidate: string, channel: ReleaseChannel): boolean {
  if (channel === 'latest' && versionChannel(candidate) === 'beta') return false;
  return compareVersions(candidate, current) > 0;
}

/**
 * Why this copy does not check for updates. `dev`: not packaged (`pnpm dev`, `pnpm e2e`, the
 * source launcher). `local-build`: packaged by `pnpm package` rather than the release workflow.
 * `env`: `ARBORA_UPDATES=off`. `setting`: the Development channel.
 */
export const updatesOffReasonSchema = z.enum(['dev', 'local-build', 'env', 'setting']);
export type UpdatesOffReason = z.infer<typeof updatesOffReasonSchema>;

export type UpdatePolicy =
  | { readonly enabled: true; readonly channel: ReleaseChannel }
  | { readonly enabled: false; readonly reason: UpdatesOffReason };

export interface UpdatePolicyInput {
  readonly kind: InstallKind;
  /** Built by the release workflow (`ARBORA_RELEASE_BUILD=true` at build time). */
  readonly releaseBuild: boolean;
  /** `process.env.ARBORA_UPDATES`. */
  readonly env: string | undefined;
  readonly channel: UpdateChannel;
}

/**
 * Whether this copy may check for, download and install updates. An unpackaged run never does, so a
 * builder's checkout is never replaced. A local `pnpm package` build stays put unless started with
 * `ARBORA_UPDATES=on`, and `ARBORA_UPDATES=off` turns any build off.
 */
export function updatePolicy(input: UpdatePolicyInput): UpdatePolicy {
  if (input.kind === 'dev') return { enabled: false, reason: 'dev' };
  const override = input.env?.trim().toLowerCase();
  if (override === 'off' || override === '0' || override === 'false') return { enabled: false, reason: 'env' };
  if (input.channel === 'off') return { enabled: false, reason: 'setting' };
  if (!input.releaseBuild && override !== 'on') return { enabled: false, reason: 'local-build' };
  return { enabled: true, channel: input.channel };
}

/** One line for Settings → Updates and the palette's **Check for Updates…**. */
export function updatesOffText(reason: UpdatesOffReason): string {
  switch (reason) {
    case 'dev':
      return 'Updates are off in development builds.';
    case 'local-build':
      return 'Updates are off in local builds. Start with ARBORA_UPDATES=on to test the updater.';
    case 'env':
      return 'Updates are off (ARBORA_UPDATES=off).';
    case 'setting':
      return 'Updates are off on the Development channel.';
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/** The branch `scripts/arbora-local` moves a clean source checkout to, or null to leave it alone. */
export function checkoutBranch(channel: UpdateChannel): 'main' | 'beta' | null {
  switch (channel) {
    case 'latest':
      return 'main';
    case 'beta':
      return 'beta';
    case 'off':
      return null;
    default: {
      const unreachable: never = channel;
      return unreachable;
    }
  }
}

export const updateStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({ status: z.literal('off'), reason: updatesOffReasonSchema }),
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

/**
 * Installers are GitHub Releases on this repository. The website links to that releases page
 * (docs/WEBSITE_DOWNLOADS.md). There is no AUR package.
 */
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
  channel: ReleaseChannel,
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
