# Releasing Arbora

Releases are GitHub Releases built by [`.github/workflows/release.yml`](../.github/workflows/release.yml). electron-updater reads the `latest*.yml` (and `beta*.yml`) files the build uploads next to the installers.

## Cut a release

1. Set `version` in `apps/desktop/package.json` (`0.2.0`, or `0.2.0-beta.1` for the beta channel) and commit it on `main`.
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`. The tag must match the version; the workflow checks.
3. The workflow builds on Linux, macOS and Windows, signs what it has secrets for, and uploads everything to a **draft** release with `SHA256SUMS-<os>.txt` files.
4. The **Performance budget** job runs the packaged Linux build against `fixtures/plain-html`: idle memory (PSS over the whole process tree) 10 s after load under 350 MB, and the median `browser.screenshot` under 300 ms. It fails the release otherwise; today the packaged build measures about 374 MB on Xvfb (see the Stage 9 gotchas).
5. The **AUR** job (stable versions only) writes `aur/PKGBUILD` and `.SRCINFO` for the new tarball and pushes them to `arbora-bin` when `AUR_SSH_KEY` is set. Without the key, download the `aur-arbora-bin` artifact and push it by hand.
6. **Publish** waits for approval on the `release` environment (add required reviewers in the repository settings), then publishes the draft. A version with `-` is marked as a prerelease.

A full run costs about 60 billed minutes (macOS at 10x, Windows at 2x). While Actions minutes are used up, do not tag.

## Without signing accounts

Arbora can ship with no Apple, Windows or AUR account; that is the current plan. Leave the secrets below unset: the workflow builds unsigned installers, skips notarization and the AUR push, and says so in the log. What users get:

- **Linux:** no difference. The AppImage updates itself; the `.deb` and tarball show what to download. Arch users can use the AppImage or tarball, or build `aur/PKGBUILD` locally with `makepkg -si`.
- **Windows:** SmartScreen warns once (**More info → Run anyway**). Updates still install in place.
- **macOS:** Gatekeeper blocks the first launch until the user clicks **Open Anyway** in System Settings → Privacy & Security. The app cannot update itself (Squirrel.Mac requires a Developer ID signature), so Arbora checks the app's own signature at startup (`codesign -dv`) and, without a team id, only tells the user to download the new `.dmg`. Apple silicon needs at least an ad-hoc signature to run; electron-builder applies one when no identity is configured. Check that on the first Mac build.

Updates are read from wherever electron-updater can reach without logging in. For GitHub Releases the repository (or a separate public releases repository) must be public. To serve downloads from a website instead, set `publish` in `electron-builder.yml` to `{ provider: generic, url: https://<site>/arbora/downloads }` and upload each release's installers with its `latest.yml`, `latest-mac.yml`, `latest-linux.yml` (and `beta*.yml`) to that folder; the in-app check for `.deb`, tarball and unsigned macOS installs then also needs that URL instead of the GitHub API.

## Secrets

All are optional (see above). Without them the build is unsigned and the workflow says so.

| Secret | Used for |
| --- | --- |
| `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` | Developer ID Application certificate (`.p12`, base64) and its password |
| `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | App Store Connect API key (`AuthKey_*.p8`, base64) for notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows OV/EV code-signing certificate (`.pfx`, base64) |
| `AUR_SSH_KEY` | SSH key registered with the AUR account that owns `arbora-bin` |

macOS uses the hardened runtime with [`build/entitlements.mac.plist`](../apps/desktop/build/entitlements.mac.plist) (JIT, unsigned executable memory, and library validation off for `node-pty` and agents' binaries). After signing, the workflow runs `codesign --verify --deep --strict` and `spctl --assess`. Native binaries (`node-pty`'s `.node` and `spawn-helper`) stay outside the asar (`asarUnpack`) so they are signed too.

For Windows, Azure Trusted Signing is the cheaper option once it is set up: add `win.azureSignOptions` (`publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`) to `electron-builder.yml` and the `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` secrets to the build step. Until a certificate exists, the installer is unsigned and users click through SmartScreen once ([FAQ](./FAQ.md#windows-smartscreen-says-windows-protected-your-pc)).

Linux packages are not signed; the checksum files are the integrity check.

## Channels and updates

- `x.y.z` goes to **Stable** (`latest`), `x.y.z-beta.n` to **Beta**. Beta users also get stable releases.
- macOS (`.dmg`/`.zip`), Windows (per-user NSIS) and the AppImage update in place.
- The `.deb`, the tarball and the AUR package are owned by a package manager or the user. Arbora checks the GitHub Releases API and shows what to run (`apt install`, `yay -Syu`, or unpack the new tarball).

## Local builds

```bash
pnpm package                                        # unsigned installers for this OS in apps/desktop/dist
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package       # macOS: skip the keychain lookup
ARBORA_APP=apps/desktop/dist/linux-unpacked/arbora xvfb-run -a pnpm perf   # the budget on a packaged build
node scripts/release-aur.mjs 0.2.0 apps/desktop/dist/arbora-0.2.0-linux-x64.tar.gz
```
