#!/usr/bin/env bash
# Point this checkout at the latest origin/<branch>: main for Stable, beta for Beta.
# Called on every launch by scripts/arbora-local with the branch from Settings → Updates
# (scripts/checkout-channel.mjs); the Development channel does not call it. Safe to run by hand:
#   scripts/update-checkout.sh beta
#
# Only a checkout that is on main or beta is moved. A feature branch, a detached HEAD, edits to
# tracked files, and commits that are not on origin stay as they are. Untracked files are left in place.
#
# Exit 0: already on origin/<branch>, or updated to it.
# Exit 2: skipped (see above).
# Exit 1: bad argument, or fetch or update failed (offline, no origin, or git error).
set -euo pipefail

branch="${1:-}"
case "$branch" in
  main | beta) ;;
  *)
    echo "usage: scripts/update-checkout.sh main|beta" >&2
    exit 1
    ;;
esac

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

# Desktop launchers do not have the login shell's PATH or ssh-agent. bash -lc does.
git_in() {
  bash -lc "cd $(printf '%q' "$repo") && $1"
}

if ! git_in "git rev-parse --is-inside-work-tree >/dev/null"; then
  echo "arbora: $repo is not a git checkout" >&2
  exit 1
fi

# A branch of your own is work in progress: never switch away from it.
current="$(git_in "git symbolic-ref --quiet --short HEAD" || true)"
if [[ "$current" != "main" && "$current" != "beta" ]]; then
  echo "arbora: checkout is on ${current:-a detached HEAD}, not main or beta; not moving it to origin/$branch" >&2
  exit 2
fi

if ! git_in "timeout 30 git fetch --quiet origin $branch"; then
  echo "arbora: could not fetch origin/$branch" >&2
  exit 1
fi

# Untracked files are not a reason to stay behind. checkout -B does not delete them.
dirty="$(git_in "git status --porcelain --untracked-files=no")"
if [[ -n "$dirty" ]]; then
  echo "arbora: local changes in $repo; not updating to origin/$branch" >&2
  exit 2
fi

# Commits that exist only here would be dropped by checkout -B.
unpushed() {
  git_in "git rev-list --count $1 --not --remotes=origin"
}
if [[ "$(unpushed HEAD)" != "0" ]]; then
  echo "arbora: $current has commits that are not on origin; not moving it" >&2
  exit 2
fi
if [[ "$current" != "$branch" ]] && git_in "git rev-parse -q --verify refs/heads/$branch >/dev/null" &&
  [[ "$(unpushed "refs/heads/$branch")" != "0" ]]; then
  echo "arbora: local $branch has commits that are not on origin; not resetting it" >&2
  exit 2
fi

before="$(git_in "git rev-parse --short HEAD")"
git_in "git checkout --quiet -B $branch origin/$branch" >/dev/null
after="$(git_in "git rev-parse --short HEAD")"
if [[ "$before" == "$after" && "$current" == "$branch" ]]; then
  echo "arbora: already on origin/$branch ($after)"
else
  echo "arbora: updated to origin/$branch ($current $before -> $after)"
fi
