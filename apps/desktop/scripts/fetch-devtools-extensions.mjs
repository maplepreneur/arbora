// Downloads the pinned React and Vue DevTools from the Chrome Web Store, verifies them against
// the checksums in resources/extensions/extensions.json and unpacks them next to it. Only the
// checksums are committed; the unpacked extensions are build output.
//
//   node scripts/fetch-devtools-extensions.mjs            verify and unpack (fails on mismatch)
//   node scripts/fetch-devtools-extensions.mjs --optional warn instead of failing (dev, tests)
//   node scripts/fetch-devtools-extensions.mjs --update   pin whatever the store serves now
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

const root = resolve(import.meta.dirname, '../resources/extensions');
const lockFile = join(root, 'extensions.json');
const update = process.argv.includes('--update');
const optional = process.argv.includes('--optional');
// Chrome version the Web Store should serve extensions for; keep it near Electron's Chromium.
const PRODVERSION = '140.0.0.0';

/**
 * @typedef {{ name: string, id: string, version: string, sha256: string }} PinnedExtension
 * @typedef {{ extensions: PinnedExtension[] }} LockFile
 */

/** @returns {LockFile} */
function readLock() {
  return /** @type {LockFile} */ (JSON.parse(readFileSync(lockFile, 'utf8')));
}

/** @param {string} id */
async function download(id) {
  const url =
    'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3' +
    `&prodversion=${PRODVERSION}&x=${encodeURIComponent(`id=${id}&uc`)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${id}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Strips the CRX header and returns the embedded zip.
 * @param {Uint8Array} crx
 */
function crxToZip(crx) {
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  if (new TextDecoder().decode(crx.subarray(0, 4)) !== 'Cr24') throw new Error('Not a CRX file');
  const version = view.getUint32(4, true);
  if (version === 3) return crx.subarray(12 + view.getUint32(8, true));
  if (version === 2) return crx.subarray(16 + view.getUint32(8, true) + view.getUint32(12, true));
  throw new Error(`Unsupported CRX version ${version}`);
}

/**
 * @param {Uint8Array} zip
 * @param {string} target
 */
function unpack(zip, target) {
  rmSync(target, { recursive: true, force: true });
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    // `_metadata/` holds Web Store signatures; Chromium refuses unpacked extensions containing it.
    if (name.endsWith('/') || name.startsWith('_metadata/')) continue;
    const file = resolve(target, name);
    if (!file.startsWith(target + sep)) throw new Error(`Refusing to write outside ${target}: ${name}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
}

/** @param {PinnedExtension} pinned */
async function fetchOne(pinned) {
  const target = join(root, pinned.name);
  const marker = join(target, '.arbora-sha256');
  if (!update && existsSync(marker) && readFileSync(marker, 'utf8').trim() === pinned.sha256) {
    console.log(`${pinned.name} ${pinned.version}: up to date`);
    return pinned;
  }
  const crx = await download(pinned.id);
  const sha256 = createHash('sha256').update(crx).digest('hex');
  const zip = crxToZip(crx);
  const manifest = /** @type {{ version: string }} */ (
    JSON.parse(new TextDecoder().decode(unzipSync(zip, { filter: (f) => f.name === 'manifest.json' })['manifest.json']))
  );
  if (!update && sha256 !== pinned.sha256) {
    throw new Error(
      `${pinned.name}: the Web Store now serves ${manifest.version} (sha256 ${sha256}), but ${pinned.version} ` +
        `(sha256 ${pinned.sha256}) is pinned. Review the release, then run this script with --update.`,
    );
  }
  unpack(zip, target);
  writeFileSync(marker, `${sha256}\n`);
  console.log(`${pinned.name} ${manifest.version}: unpacked to ${target}`);
  return { ...pinned, version: manifest.version, sha256 };
}

/** Names passed as `--only <name>`, repeated for several. */
function onlyNames() {
  const names = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--only' && process.argv[i + 1]) names.push(process.argv[i + 1]);
  }
  return names;
}

async function main() {
  const lock = readLock();
  const only = onlyNames();
  const selected = only.length === 0 ? lock.extensions : lock.extensions.filter((entry) => only.includes(entry.name));
  const missing = only.filter((name) => !selected.some((entry) => entry.name === name));
  if (missing.length > 0) throw new Error(`Unknown extension: ${missing.join(', ')}`);
  const results = [];
  for (const pinned of selected) results.push(await fetchOne(pinned));
  if (update) {
    const byName = new Map(lock.extensions.map((entry) => [entry.name, entry]));
    for (const next of results) byName.set(next.name, next);
    const order = lock.extensions.map((entry) => entry.name);
    for (const next of results) if (!order.includes(next.name)) order.push(next.name);
    const extensions = order.map((name) => byName.get(name));
    writeFileSync(lockFile, `${JSON.stringify({ extensions }, null, 2)}\n`);
  }
}

main().catch((/** @type {unknown} */ error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (optional) {
    console.warn(`DevTools extensions unavailable (Arbora runs without them): ${message}`);
    return;
  }
  console.error(message);
  process.exitCode = 1;
});
