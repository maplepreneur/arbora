# Releasing Arbora

Releases are GitHub Releases on the public repository `maplepreneur/arbora`, built by [`.github/workflows/release.yml`](../.github/workflows/release.yml). electron-updater reads the `latest*.yml` (and `beta*.yml`) files uploaded next to the installers. The website links to [the releases page](https://github.com/maplepreneur/arbora/releases) and does not host the files. There is no AUR package. Setup and the download-page notes are in [WEBSITE_DOWNLOADS.md](./WEBSITE_DOWNLOADS.md).

## Cut a release

Merging a pull request into `main` does this. Feature work lands on `beta` first; `main` is only what is ready to ship.

1. [`.github/workflows/release-main.yml`](../.github/workflows/release-main.yml) reads `version` in `apps/desktop/package.json`. If `v` plus that version is not a tag yet, it tags the merge. If the tag already exists, it bumps the patch (`0.0.1` → `0.0.2`), commits `chore: release v…`, and tags that commit.
2. It starts [`.github/workflows/release.yml`](../.github/workflows/release.yml) for that tag. The build runs on Linux, macOS and Windows, signs what it has secrets for, and uploads a draft with `SHA256SUMS-<os>.txt` files and versionless copies (`Arbora-<os>-<arch>.<ext>`).
3. The **Performance budget** job runs the packaged Linux build against `fixtures/plain-html`: idle memory (PSS over the whole process tree) 10 s after load under 350 MB, and the median `browser.screenshot` under 300 ms. The packaged build measured about 374 MB on Xvfb, and the `v0.0.4` job measured 442 MB (retry 418 MB), because that sum includes the two zygote processes (see the Stage 9 gotchas). The job reports that and does not block publish.
4. **Publish** makes the draft public and marks a stable version Latest. A version with `-` is a prerelease. The AUR recipe in `aur/` is not built or pushed. `main` is then merged back into `beta` so the testing line has the version bump.

A full run costs about 60 billed minutes (macOS at 10x, Windows at 2x). Every merge to `main` spends that. To rebuild a tag that already exists: **Actions → Release → Run workflow**, with the tag (for example `v0.0.1`). The workflow file that runs is the one in that tag, so a signing fix has to be in the commit the tag points at. An empty `CSC_LINK` must be unset or the macOS build fails with `not a file` (Stage 9 gotchas).

The git branch `beta` is where pull requests land for testing. Merging into it publishes nothing. The in-app Beta channel gets a prerelease from it only when someone runs **Cut a beta** (below).

## Publish a beta

**Actions → Cut a beta → Run workflow**, with **Use workflow from** set to `beta`. Do this when `beta` has something worth testing, not after every merge: each run is a full release, about 60 billed minutes.

1. [`.github/workflows/release-beta.yml`](../.github/workflows/release-beta.yml) picks the next `x.y.z-beta.n` (`scripts/release-version.mjs beta`). `x.y.z` is the stable version that has not shipped yet: the `version` in `apps/desktop/package.json` when it is ahead of every stable tag and untagged, otherwise one patch above the newest stable tag. `n` counts up from the betas already tagged for that version. After `v0.0.3`, the first beta is `0.0.4-beta.1`, then `0.0.4-beta.2`, and the next merge into `main` publishes `0.0.4`.
2. It commits that version to `package.json` on top of the tip of `beta`, tags that commit, and pushes only the tag. The `beta` branch keeps its plain `x.y.z`, so `release-main.yml` works as before.
3. It starts Release for the tag. Publish marks a version with `-` as a prerelease and does not make it Latest, so `releases/latest` and Stable users never see it.

Beta users update to the newest of the betas and the stable releases: a beta sorts above the stable release before it and below the one it leads to. A user who switches from Beta to Stable stays on their beta until the next stable release (the updater does not downgrade). GitHub only lists a `workflow_dispatch` workflow once the file is on the default branch, so **Cut a beta** appears after this file reaches `main`. Do not run it from another branch; the job skips anything but `beta`.

## Without signing accounts

Arbora ships with no Apple or Windows signing account. Leave the secrets below unset: the workflow builds unsigned installers, skips notarization, and says so in the log. What users get:

- **Linux:** Arch and Omarchy use the AppImage, which updates itself. Debian and Ubuntu use the `.deb`, which shows what to download. There is no AUR package. A `.tar.gz` is also uploaded for the memory check.
- **Windows:** SmartScreen warns once (**More info → Run anyway**). Updates still install in place.
- **macOS:** Gatekeeper blocks the first launch until the user clicks **Open Anyway** in System Settings → Privacy & Security. The app cannot update itself (Squirrel.Mac requires a Developer ID signature), so Arbora checks the app's own signature at startup (`codesign -dv`) and, without a team id, only tells the user to download the new `.dmg`. The bundle must still carry an ad-hoc signature, or macOS reports a downloaded copy as "damaged and can't be opened" with no Open Anyway. electron-builder does not add one by itself: with no identity and `CSC_IDENTITY_AUTO_DISCOVERY=false` it logs `skipped macOS application code signing` and leaves the bundle unsealed (that is what broke `v0.0.2`). So without a certificate the workflow passes `-c.mac.identity=-`, and the **Verify the macOS signature** step runs `codesign --verify --deep --strict` on every macOS build. Do not put `identity: "-"` in `electron-builder.yml`: it would replace the Developer ID once a certificate exists.

The repository is public, so the updater and the website can read releases without a token. The website links to the [releases page](https://github.com/maplepreneur/arbora/releases) ([WEBSITE_DOWNLOADS.md](./WEBSITE_DOWNLOADS.md)). To host the files on the website itself instead, set `publish` in `electron-builder.yml` to `{ provider: generic, url: https://<site>/arbora/downloads }` and upload each release's installers with its `latest.yml`, `latest-mac.yml`, `latest-linux.yml` (and `beta*.yml`) to that folder; the in-app check for `.deb`, tarball and unsigned macOS installs then also needs that URL instead of the GitHub API.

## Secrets

All are optional (see above). Without them the build is unsigned and the workflow says so.

| Secret | Used for |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (`.p12`, base64) and its password |
| `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key (`AuthKey_*.p8`, base64) for notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows OV/EV code-signing certificate (`.pfx`, base64) |

macOS uses the hardened runtime with [`build/entitlements.mac.plist`](../apps/desktop/build/entitlements.mac.plist) (JIT, unsigned executable memory, and library validation off for `node-pty` and agents' binaries). After signing, the workflow runs `codesign --verify --deep --strict` and `spctl --assess`. Native binaries (`node-pty`'s `.node` and `spawn-helper`) stay outside the asar (`asarUnpack`) so they are signed too.

For Windows, Azure Trusted Signing is the cheaper option once it is set up: add `win.azureSignOptions` (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`) to `electron-builder.yml` and the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` secrets to the build step. Until a certificate exists, the installer is unsigned and users click through SmartScreen once ([FAQ](./FAQ.md#windows-smartscreen-says-windows-protected-your-pc)).

Linux packages are not signed; the checksum files are the integrity check.

## Channels and updates

Settings → Updates & diagnostics → **Channel**:

- **Stable** (`latest`, the default) gets `x.y.z`.
- **Beta** (`beta`) gets `x.y.z-beta.n` from **Cut a beta**, and every stable release.
- **Development** (`off`) never checks, downloads or installs an update. A downloaded update does not install on quit either.

Builds that are not from `release.yml` never update, whatever the channel says, so a builder's copy is never replaced (`updatePolicy` in `packages/shared/src/updates.ts`):

- `pnpm dev`, `pnpm e2e` and `scripts/arbora-local` run unpackaged (`installKind: dev`). Settings shows "Updates are off in development builds." The launcher moves its checkout by channel instead (README, "Use your checkout as an installed app").
- `pnpm package` and `package.yml` builds are packaged but are not release builds: `release.yml` sets `ARBORA_RELEASE_BUILD=true` while it builds, electron-vite bakes that into `out/main/index.js`, and the **The build checks for updates** step fails the job if it is missing. Start a local build with `ARBORA_UPDATES=on` to test the updater against the published releases.
- `ARBORA_UPDATES=off` turns updates off in any build, and the launcher then leaves the checkout alone too.

How each install updates:

- macOS (`.dmg`/`.zip`), Windows (per-user NSIS) and the AppImage update in place.
- The `.deb` and the tarball are installed by the user. Arbora checks the GitHub Releases API and shows what to download.

## Local builds

```bash
pnpm package                                        # unsigned installers for this OS in apps/desktop/dist (never self-update)
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package -c.mac.identity=-   # macOS: skip the keychain, ad-hoc sign
ARBORA_APP=apps/desktop/dist/linux-unpacked/arbora xvfb-run -a pnpm perf   # the budget on a packaged build
```
