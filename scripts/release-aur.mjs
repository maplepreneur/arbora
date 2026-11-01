#!/usr/bin/env node
// Bumps aur/PKGBUILD to a release and regenerates aur/.SRCINFO.
//
//   node scripts/release-aur.mjs <version> <path-to-linux-x64.tar.gz>
//   node scripts/release-aur.mjs --check          (verify .SRCINFO matches PKGBUILD)
//   node scripts/release-aur.mjs --srcinfo        (regenerate .SRCINFO after editing PKGBUILD)
//
// The release workflow runs it after the Linux build with the tarball it just uploaded, then
// pushes aur/ to ssh://aur@aur.archlinux.org/arbora-bin.git when AUR_SSH_KEY is set.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'aur');
const PKGBUILD = join(AUR_DIR, 'PKGBUILD');
const SRCINFO = join(AUR_DIR, '.SRCINFO');
const LOCAL_SOURCES = ['arbora.sh', 'arbora.desktop', 'arbora.svg'];

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Reads a scalar `name=value` or array `name=(...)` from PKGBUILD text (no shell evaluation). */
export function readVar(text, name) {
  const start = new RegExp(`^${name}=`, 'm').exec(text);
  if (!start) return undefined;
  let i = start.index + start[0].length;
  if (text[i] !== '(') {
    const end = text.indexOf('\n', i);
    return text.slice(i, end === -1 ? undefined : end).replace(/^['"]|['"]$/g, '');
  }
  const values = [];
  for (i++; i < text.length && text[i] !== ')'; i++) {
    const quote = text[i];
    if (quote !== "'" && quote !== '"') continue;
    const close = text.indexOf(quote, i + 1);
    values.push(text.slice(i + 1, close));
    i = close;
  }
  return values;
}

export function bump(text, version, sums) {
  return text
    .replace(/^pkgver=.*$/m, `pkgver=${version}`)
    .replace(/^pkgrel=.*$/m, 'pkgrel=1')
    .replace(/^sha256sums=\([\s\S]*?\)/m, `sha256sums=(${sums.map((s) => `'${s}'`).join('\n            ')})`);
}

export function srcinfo(text) {
  const pkgname = readVar(text, 'pkgname');
  const pkgver = readVar(text, 'pkgver');
  const expand = (value) => value.replaceAll('${pkgver}', pkgver).replaceAll('${pkgname}', pkgname);
  const lines = [`pkgbase = ${pkgname}`];
  const push = (key, values) => {
    for (const value of [values].flat()) if (value !== undefined) lines.push(`\t${key} = ${expand(value)}`);
  };
  push('pkgdesc', readVar(text, 'pkgdesc'));
  push('pkgver', pkgver);
  push('pkgrel', readVar(text, 'pkgrel'));
  push('url', readVar(text, 'url'));
  for (const key of ['arch', 'license', 'depends', 'optdepends', 'provides', 'conflicts', 'options', 'source']) {
    push(key, readVar(text, key));
  }
  push('sha256sums', readVar(text, 'sha256sums'));
  lines.push('', `pkgname = ${pkgname}`, '');
  return lines.join('\n');
}

function main() {
  const [first, tarball] = process.argv.slice(2);
  if (first === '--srcinfo') {
    writeFileSync(SRCINFO, srcinfo(readFileSync(PKGBUILD, 'utf8')));
    return;
  }
  if (first === '--check') {
    const text = readFileSync(PKGBUILD, 'utf8');
    if (readFileSync(SRCINFO, 'utf8') !== srcinfo(text)) {
      console.error('aur/.SRCINFO is out of date; run scripts/release-aur.mjs');
      process.exit(1);
    }
    console.log('aur/.SRCINFO matches PKGBUILD');
    return;
  }
  const version = first?.replace(/^v/, '');
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !tarball) {
    console.error('usage: release-aur.mjs <x.y.z> <arbora-<x.y.z>-linux-x64.tar.gz> (stable releases only)');
    process.exit(2);
  }
  const sums = [sha256(tarball), ...LOCAL_SOURCES.map((name) => sha256(join(AUR_DIR, name)))];
  const next = bump(readFileSync(PKGBUILD, 'utf8'), version, sums);
  writeFileSync(PKGBUILD, next);
  writeFileSync(SRCINFO, srcinfo(next));
  console.log(`aur/PKGBUILD -> ${version} (${sums[0]})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
