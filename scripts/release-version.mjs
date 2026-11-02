// Picks the stable version a merge to main should publish.
//
//   node scripts/release-version.mjs next 0.0.1 false   # 0.0.1 (tag not created yet)
//   node scripts/release-version.mjs next 0.0.1 true    # 0.0.2
//   node scripts/release-version.mjs write 0.0.2        # sets apps/desktop/package.json

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DESKTOP_PACKAGE = 'apps/desktop/package.json';

export function nextReleaseVersion(current, tagExists) {
  if (!/^\d+\.\d+\.\d+$/.test(current)) {
    throw new Error(`Release versions are x.y.z, got ${current}`);
  }
  if (!tagExists) return current;
  const [major, minor, patch] = current.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

export function writeReleaseVersion(text, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Release versions are x.y.z, got ${version}`);
  }
  const pattern = /("version"\s*:\s*")[^"]+(")/;
  if (!pattern.test(text)) throw new Error('package.json has no version');
  return text.replace(pattern, `$1${version}$2`);
}

function main() {
  const [command, version, flag] = process.argv.slice(2);
  if (command === 'next') {
    console.log(nextReleaseVersion(version, flag === 'true'));
    return;
  }
  if (command === 'write') {
    const text = readFileSync(DESKTOP_PACKAGE, 'utf8');
    writeFileSync(DESKTOP_PACKAGE, writeReleaseVersion(text, version));
    return;
  }
  console.error('usage: release-version.mjs next <x.y.z> <true|false> | write <x.y.z>');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
