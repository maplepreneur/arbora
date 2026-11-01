# Arbora downloads: GitHub Releases and a website download page

This document is self-contained. Hand it to a person or an AI assistant together with access to the website's code. Part 1 is done once in GitHub, Part 2 is each release, and Part 3 is the download page.

## How it fits together

```
maplepreneur/arbora            (private)  source code, CI, the release workflow
        │  git tag v0.1.0 → .github/workflows/release.yml
        ▼
maplepreneur/arbora-releases   (public)   GitHub Releases with the installers, nothing else
        │
        ├── Arbora's built-in updater reads latest*.yml from here (no login needed)
        ├── the AUR package (aur/PKGBUILD) downloads the tarball from here
        └── the website's download page links to the files here
```

The installers are unsigned (there are no Apple, Windows or AUR accounts). That works:

- **Linux:** no warnings. The AppImage updates itself; the `.deb` and the tarball show "a new version is available" with a link.
- **Windows:** SmartScreen warns once ("More info" → "Run anyway"). Updates install in place.
- **macOS:** the first launch is blocked until the user clicks "Open Anyway" in System Settings → Privacy & Security. The app cannot update itself (macOS only installs updates for Developer ID signed apps), so it shows "a new version is available" with a link.

The download page must explain the Windows and macOS steps (Part 3 has the wording).

---

## Part 1: one-time GitHub setup

Do these in order. Steps 1–4 are clicks in github.com; nothing in the source code needs to change, because the source repository already points at `maplepreneur/arbora-releases`.

### 1. Create the public releases repository

1. github.com → **New repository**.
2. Owner `maplepreneur`, name **`arbora-releases`**, visibility **Public**.
3. Tick **Add a README file** (a release needs at least one commit to tag). Suggested README text:

   ```markdown
   # Arbora releases

   Installers for [Arbora](https://<your-website>/). Download the latest version from the
   [download page](https://<your-website>/download) or from [Releases](../../releases/latest).
   Source code is not in this repository.
   ```

4. In the new repository: **Settings → General → Features**, untick Issues, Wiki and Projects if you do not want them (optional).

If you would rather keep everything in one place, you can instead make `maplepreneur/arbora` public and change `repo: arbora-releases` back to `repo: arbora` in `apps/desktop/electron-builder.yml`, `UPDATE_REPOSITORY` in `packages/shared/src/updates.ts`, `RELEASES_REPO` in `.github/workflows/release.yml`, and the URLs in `aur/PKGBUILD`. The rest of this document then applies with `arbora` in place of `arbora-releases`.

### 2. Create a token that can publish there

The release workflow runs in the private repository and must write releases to the public one, which the built-in `GITHUB_TOKEN` cannot do.

1. github.com → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name: `arbora-releases publish`. Expiration: up to a year (put a reminder in your calendar to renew it).
3. **Resource owner:** `maplepreneur`. **Repository access:** Only select repositories → `arbora-releases`.
4. **Repository permissions → Contents: Read and write.** (Metadata: Read-only is added automatically.) Nothing else.
5. Generate and copy the token.
6. In the **private** repository `maplepreneur/arbora`: **Settings → Secrets and variables → Actions → New repository secret**. Name **`RELEASES_TOKEN`**, value: the token.

The workflow stops with "Add the RELEASES_TOKEN secret" when it is missing.

### 3. Add the approval gate

1. In `maplepreneur/arbora`: **Settings → Environments → New environment**, name **`release`**.
2. Tick **Required reviewers** and add yourself.

Every release waits for you to approve the **Publish the release** job before it becomes public. Until then it is a draft that only you can see.

### 4. Make sure Actions can run

A release builds on Linux, macOS and Windows: about 60 billed minutes on a private repository (macOS counts 10x, Windows 2x). Check **Settings → Billing and plans** for remaining minutes, or set a spending limit. The ordinary push CI is not affected.

### 5. (Optional) Signing and the AUR later

All optional secrets (`MAC_CSC_LINK`, `APPLE_API_KEY_*`, `WIN_CSC_LINK`, `AUR_SSH_KEY`) are described in [RELEASING.md](./RELEASING.md). Leave them unset for unsigned releases.

---

## Part 2: cutting a release

1. Set `"version"` in `apps/desktop/package.json` (for example `0.1.0`; a version like `0.2.0-beta.1` becomes a prerelease on the beta channel). Commit and push to `main`.
2. Tag and push the tag from the **private** repository:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Watch **Actions → Release** in `maplepreneur/arbora`. It:
   - builds and uploads everything to a **draft** release `v0.1.0` in `arbora-releases`,
   - adds `SHA256SUMS-Linux.txt`, `SHA256SUMS-macOS.txt`, `SHA256SUMS-Windows.txt`,
   - adds versionless copies (below) for stable links,
   - runs the performance budget on the packaged Linux build,
   - writes the AUR files as an artifact (pushes them only when `AUR_SSH_KEY` is set),
   - waits for your approval, then publishes the release and marks it **Latest** (prereleases are not marked Latest).
4. Optionally edit the release notes in `arbora-releases` → Releases before approving. The in-app update dialog shows them.

### Files in every release

`<v>` is the version without the `v`, for example `0.1.0`.

| Platform | Versioned file (used by the updater) | Stable copy (use on the website) |
| --- | --- | --- |
| Windows x64 installer | `arbora-<v>-win-x64.exe` | `Arbora-win-x64.exe` |
| macOS Apple silicon | `arbora-<v>-mac-arm64.dmg` (+ `.zip`) | `Arbora-mac-arm64.dmg` |
| macOS Intel | `arbora-<v>-mac-x64.dmg` (+ `.zip`) | `Arbora-mac-x64.dmg` |
| Linux AppImage | `arbora-<v>-linux-x86_64.AppImage` | `Arbora-linux-x86_64.AppImage` |
| Debian / Ubuntu | `arbora-<v>-linux-amd64.deb` | `Arbora-linux-amd64.deb` |
| Linux tarball (Arch, others) | `arbora-<v>-linux-x64.tar.gz` | `Arbora-linux-x64.tar.gz` |
| Checksums | `SHA256SUMS-Linux.txt`, `SHA256SUMS-macOS.txt`, `SHA256SUMS-Windows.txt` | same |
| Updater metadata (do not link) | `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `*.blockmap` | |

Stable links that always point at the newest published, non-prerelease version:

```
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-win-x64.exe
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-mac-arm64.dmg
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-mac-x64.dmg
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-linux-x86_64.AppImage
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-linux-amd64.deb
https://github.com/maplepreneur/arbora-releases/releases/latest/download/Arbora-linux-x64.tar.gz
```

Do not delete or rename the versioned files or the `latest*.yml` files: installed copies of Arbora read them to find updates.

---

## Part 3: the website download page (instructions for the implementer)

### Requirements

1. A page at `/download` (or wherever fits the site) that offers Arbora for Windows, macOS (Apple silicon and Intel) and Linux (AppImage, `.deb`, tarball), plus a "Beta" link to prereleases if the site wants one.
2. Detect the visitor's OS and, on macOS, the chip; show one primary **Download for <OS>** button for it and list every other file under "Other platforms". Detection must never hide the other files.
3. Show the current version number and release date, a link to the release notes, and a link to the checksums.
4. Show the install steps for each platform (wording below), especially the Windows SmartScreen and macOS "Open Anyway" steps.
5. Work without JavaScript for the links themselves (detection is an enhancement), and without any GitHub token in the browser.
6. Must not depend on the GitHub API on every page view: unauthenticated API calls are limited to 60 per hour per IP. Use the stable links (approach A), or fetch the API on the server with caching (approach B).

### Approach A: static page with stable links (simplest; recommended to start)

Use the stable URLs from Part 2 directly as `href`s. No build step, no API, no rate limits. The page always serves the newest stable release because GitHub redirects `releases/latest/download/<name>` to the newest non-prerelease release that has that file.

The version number is not in those links. To show it, either type it by hand, or add approach B's version fetch with caching.

### Approach B: version and notes from the GitHub API, cached on the server

Fetch `https://api.github.com/repos/maplepreneur/arbora-releases/releases/latest` on the server (at build time for a static site, or with a revalidation window such as one hour). That returns `tag_name`, `name`, `published_at`, `html_url`, `body` (Markdown release notes) and `assets[]` with `name`, `browser_download_url` and `size`. For a beta link, fetch `/releases?per_page=10` and take the first entry with `prerelease: true`.

Match assets by name, not by position:

```ts
// assets.ts: shared by the server fetch and the page
export type Platform = 'win-x64' | 'mac-arm64' | 'mac-x64' | 'linux-appimage' | 'linux-deb' | 'linux-tar';

export const PLATFORMS: Record<Platform, { label: string; stable: string; pattern: RegExp }> = {
  'win-x64': { label: 'Windows (64-bit)', stable: 'Arbora-win-x64.exe', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-win-x64\.exe$/ },
  'mac-arm64': { label: 'macOS (Apple silicon)', stable: 'Arbora-mac-arm64.dmg', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-mac-arm64\.dmg$/ },
  'mac-x64': { label: 'macOS (Intel)', stable: 'Arbora-mac-x64.dmg', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-mac-x64\.dmg$/ },
  'linux-appimage': { label: 'Linux AppImage', stable: 'Arbora-linux-x86_64.AppImage', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-linux-x86_64\.AppImage$/ },
  'linux-deb': { label: 'Debian / Ubuntu (.deb)', stable: 'Arbora-linux-amd64.deb', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-linux-amd64\.deb$/ },
  'linux-tar': { label: 'Linux tarball (.tar.gz)', stable: 'Arbora-linux-x64.tar.gz', pattern: /^arbora-[\d.]+(?:-[\w.]+)?-linux-x64\.tar\.gz$/ },
};

const REPO = 'maplepreneur/arbora-releases';

export interface ReleaseInfo {
  version: string; // "0.1.0"
  publishedAt: string; // ISO date
  notesUrl: string;
  notesMarkdown: string;
  files: Partial<Record<Platform, { url: string; size: number }>>;
  checksums: { name: string; url: string }[];
}

/** Server-only. Cache the result (for example one hour); never call this from the browser. */
export async function latestRelease(): Promise<ReleaseInfo | null> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) return null; // 404 until the first release is published
  const release = (await response.json()) as {
    tag_name: string;
    published_at: string;
    html_url: string;
    body: string | null;
    assets: { name: string; browser_download_url: string; size: number }[];
  };
  const files: ReleaseInfo['files'] = {};
  for (const [platform, spec] of Object.entries(PLATFORMS) as [Platform, (typeof PLATFORMS)[Platform]][]) {
    const asset = release.assets.find((a) => spec.pattern.test(a.name));
    if (asset) files[platform] = { url: asset.browser_download_url, size: asset.size };
  }
  return {
    version: release.tag_name.replace(/^v/, ''),
    publishedAt: release.published_at,
    notesUrl: release.html_url,
    notesMarkdown: release.body ?? '',
    files,
    checksums: release.assets
      .filter((a) => a.name.startsWith('SHA256SUMS-'))
      .map((a) => ({ name: a.name, url: a.browser_download_url })),
  };
}

/** Fallback when the API is unavailable: the stable links still work. */
export function stableUrl(platform: Platform): string {
  return `https://github.com/${REPO}/releases/latest/download/${PLATFORMS[platform].stable}`;
}
```

For Next.js (App Router), call `latestRelease()` in a server component with `export const revalidate = 3600;`. Astro: call it in the page frontmatter at build time and rebuild on a schedule or with a GitHub webhook. A plain static site: generate a `release.json` at build time with the same function. If you add a GitHub token on the server to raise the rate limit, keep it server-side only.

### OS and chip detection (progressive enhancement)

```ts
// Runs in the browser after load; only changes which button is primary.
export async function detectPlatform(): Promise<Platform | null> {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
  };
  const platform = (nav.userAgentData?.platform ?? navigator.platform ?? '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (platform.includes('win') || ua.includes('windows')) return 'win-x64';
  if (platform.includes('mac') || ua.includes('mac os')) {
    // Chromium browsers report the chip; Safari and Firefox do not, so default to Apple silicon
    // (nearly every Mac sold since 2021) and keep the Intel link visible.
    const arch = await nav.userAgentData?.getHighEntropyValues?.(['architecture']).catch(() => undefined);
    return arch?.architecture === 'x86' ? 'mac-x64' : 'mac-arm64';
  }
  if (platform.includes('linux') || ua.includes('linux')) {
    if (ua.includes('android')) return null;
    return /ubuntu|debian/.test(ua) ? 'linux-deb' : 'linux-appimage';
  }
  return null; // iOS, Android, unknown: show all files, primary button hidden or "See all downloads"
}
```

### Install steps to show (copy as is)

**Windows**

1. Run `Arbora-win-x64.exe`. Windows may say "Windows protected your PC": click **More info**, then **Run anyway**. Arbora is not code-signed yet.
2. The installer is per user and needs no administrator rights. Arbora updates itself.

**macOS**

1. Open the `.dmg` and drag **Arbora** to **Applications**.
2. Open Arbora once. macOS blocks it because it is not signed with an Apple Developer ID.
3. Open **System Settings → Privacy & Security**, scroll to the message about Arbora and click **Open Anyway**, then confirm. (On macOS 15 and later, right-click → Open no longer skips this.)
   Or in Terminal: `xattr -dr com.apple.quarantine /Applications/Arbora.app`
4. Updates: Arbora tells you when a new version is out. Download the new `.dmg` and replace the app.

**Linux**

- **AppImage** (any distribution): `chmod +x Arbora-linux-x86_64.AppImage && ./Arbora-linux-x86_64.AppImage`. Needs FUSE 2 (`sudo pacman -S fuse2`, `sudo apt install libfuse2`). Updates itself.
- **Debian / Ubuntu**: `sudo apt install ./Arbora-linux-amd64.deb`. Arbora tells you when to download a new `.deb`.
- **Arch / Omarchy and others**: extract the tarball and run `./arbora`. For a system install with a menu entry, use the AUR recipe: download the repository's `aur/` folder (or the `aur-arbora-bin` artifact of the release workflow) and run `makepkg -si` there.
- If you see "The SUID sandbox helper binary was found, but is not configured correctly" with the tarball, run `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` in its folder.

**Verify a download (optional)**: compare `sha256sum <file>` (Linux), `shasum -a 256 <file>` (macOS) or `Get-FileHash <file>` (PowerShell) with the matching line in `SHA256SUMS-<OS>.txt`.

### Page content checklist

- Heading, one-line description, the primary download button with the detected platform and file size.
- "Other platforms" with all six files, each with its label and size.
- Version, date, "Release notes" (links to `notesUrl`), "Checksums".
- The install steps above, the platform's section expanded by default.
- System requirements: Windows 10 or 11 (64-bit), macOS 12 or later, Linux x86_64 with a desktop session (Wayland or X11); Node.js only for npx-based agents.
- Links: "Set up your agents" (Claude Code, Codex, Kimi Code, Grok Build, OpenCode) and the FAQ, if the site hosts those pages. Their text is in the source repository's `docs/AGENT_SETUP.md` and `docs/FAQ.md`.
- Before the first release is published the API returns 404: show "Coming soon" instead of broken links (approach B), or keep the page unlinked (approach A).

### Acceptance tests for the page

- With JavaScript off, every download link works.
- In Chrome on Windows the primary button downloads `Arbora-win-x64.exe`; in Safari on macOS it offers Apple silicon and the Intel link is visible; on Ubuntu Firefox it offers the `.deb`.
- After a new stable release is published, the page shows the new version within the cache window, without a code change.
- A prerelease does not replace the stable version on the page.
- No GitHub token appears in the browser's network requests or the page source.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Workflow fails at "Releases token present" | Add `RELEASES_TOKEN` (Part 1, step 2). |
| `HttpError: Resource not accessible by personal access token` | The token lacks **Contents: Read and write** on `arbora-releases`, or it expired. |
| Release stays a draft | The **Publish the release** job waits for approval in the `release` environment (Actions → the run → Review deployments). |
| `releases/latest/download/...` returns 404 | No published non-prerelease release yet, or the stable copies were not uploaded (see the "Versionless copies" step log). |
| Installed Arbora says "Could not check for updates: GitHub answered 404" | `arbora-releases` is private or has no published release. |
| Performance budget job fails | Idle memory above 350 MB; see `docs/BUILD_STAGES.md`, Stage 9 gotchas. Approving publish is blocked until it passes. |
