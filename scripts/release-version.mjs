// Picks the version a release should publish.
//
//   node scripts/release-version.mjs next 0.0.1 false   # 0.0.1 (tag not created yet)
//   node scripts/release-version.mjs next 0.0.1 true    # 0.0.2
//   git tag -l 'v*' | node scripts/release-version.mjs beta 0.0.3   # 0.0.4-beta.1, then -beta.2, ...
//   node scripts/release-version.mjs write 0.0.2        # sets apps/desktop/package.json

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DESKTOP_PACKAGE = 'apps/desktop/package.json';
const STABLE = /^\d+\.\d+\.\d+$/;
const BETA = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/;

export function nextReleaseVersion(current, tagExists) {
  if (!STABLE.test(current)) {
    throw new Error(`Release versions are x.y.z, got ${current}`);
  }
  if (!tagExists) return current;
  const [major, minor, patch] = current.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function compareStable(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/**
 * The next `x.y.z-beta.n`, where x.y.z is the stable version that has not shipped yet: the
 * version in package.json if no tag has it and it is above every stable tag, otherwise one patch
 * above the newest stable tag. That sorts it above every published stable release and below the
 * stable release it leads to. `n` counts up from the betas already tagged for that x.y.z.
 */
export function nextBetaVersion(current, tags) {
  if (!STABLE.test(current)) {
    throw new Error(`The beta branch version must be x.y.z, got ${current}`);
  }
  const versions = tags.map((tag) => tag.trim().replace(/^v/, '')).filter(Boolean);
  const stable = versions.filter((version) => STABLE.test(version)).sort(compareStable);
  const newest = stable.at(-1);
  const base = newest === undefined || compareStable(current, newest) > 0 ? current : nextReleaseVersion(newest, true);
  let n = 0;
  for (const version of versions) {
    const match = BETA.exec(version);
    if (match && match[1] === base) n = Math.max(n, Number(match[2]));
  }
  return `${base}-beta.${n + 1}`;
}

export function writeReleaseVersion(text, version) {
  if (!STABLE.test(version) && !BETA.test(version)) {
    throw new Error(`Release versions are x.y.z or x.y.z-beta.n, got ${version}`);
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
  if (command === 'beta') {
    console.log(nextBetaVersion(version, readFileSync(0, 'utf8').split('\n')));
    return;
  }
  if (command === 'write') {
    const text = readFileSync(DESKTOP_PACKAGE, 'utf8');
    writeFileSync(DESKTOP_PACKAGE, writeReleaseVersion(text, version));
    return;
  }
  console.error(
    'usage: release-version.mjs next <x.y.z> <true|false> | beta <x.y.z> (tags on stdin) | write <version>',
  );
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
