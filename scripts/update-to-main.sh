#!/usr/bin/env bash
# Point this checkout at the latest origin/main.
# Called on every launch by scripts/arbora-local. Safe to run by hand.
#
# Exit 0: already on origin/main, or updated to it.
# Exit 2: skipped, because tracked files are dirty or HEAD has commits that are not on origin/main.
# Untracked files are left in place.
# Exit 1: fetch or update failed (offline, no origin, or git error).
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

# Desktop launchers do not have the login shell's PATH or ssh-agent. bash -lc does.
git_in() {
  bash -lc "cd $(printf '%q' "$repo") && $1"
}

if ! git_in "git rev-parse --is-inside-work-tree >/dev/null"; then
  echo "arbora: $repo is not a git checkout" >&2
  exit 1
fi

if ! git_in "timeout 30 git fetch --quiet origin main"; then
  echo "arbora: could not fetch origin/main" >&2
  exit 1
fi

# Untracked files are not a reason to stay behind. reset does not delete them.
dirty="$(git_in "git status --porcelain --untracked-files=no")"
if [[ -n "$dirty" ]]; then
  echo "arbora: local changes in $repo; not updating to origin/main" >&2
  exit 2
fi

# A clean branch that has its own commits stays put. reset --hard would drop them.
if ! git_in "git merge-base --is-ancestor HEAD origin/main"; then
  echo "arbora: this checkout has commits that are not on origin/main; not resetting" >&2
  exit 2
fi

before="$(git_in "git rev-parse --short HEAD")"
git_in "git checkout --quiet main && git reset --hard origin/main" >/dev/null
after="$(git_in "git rev-parse --short HEAD")"
if [[ "$before" == "$after" ]]; then
  echo "arbora: already on origin/main ($after)"
else
  echo "arbora: updated to origin/main ($before -> $after)"
fi
