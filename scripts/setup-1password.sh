#!/bin/sh
# Connects 1Password so Arbora can fill logins in the app and in tools such as Figma.
# The password stays in 1Password. This script never prints a secret.
#
#   pnpm setup:1password --check
#   pnpm setup:1password --yes
#   pnpm setup:1password --uninstall
set -eu

CHECK=0
YES=0
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --yes) YES=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help)
      echo "Usage: setup-1password.sh [--check | --yes | --uninstall]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

op_status() {
  if command -v op >/dev/null 2>&1; then
    version=$(op --version 2>/dev/null || true)
    echo "op: ${version:-present}"
    return 0
  fi
  echo "op: not installed"
  return 1
}

check_row() {
  label=$1
  state=$2
  detail=$3
  if [ -n "$detail" ]; then
    echo "$label: $state ($detail)"
  else
    echo "$label: $state"
  fi
}

report_check() {
  echo "os: $(uname -s)"
  if op_status; then
    CHECK_STATUS=0
  else
    CHECK_STATUS=1
  fi
  if [ "$CHECK_STATUS" = 0 ]; then
    accounts=$(op account list --format json 2>/dev/null || true)
    case "$accounts" in
      \[\]) check_row account fail "no account" ;;
      \[*) check_row account pass "signed in" ;;
      *) check_row account fail "could not list accounts" ;;
    esac
  else
    check_row account fail "op is not installed"
  fi
  case "$(uname -s)" in
    Darwin)
      if pgrep -x 1Password >/dev/null 2>&1; then check_row desktop pass ""; else check_row desktop fail "app not running"; fi
      ;;
    Linux)
      if pgrep -x 1password >/dev/null 2>&1; then check_row desktop pass ""; else check_row desktop fail "app not running"; fi
      ;;
    *)
      check_row desktop fail "not checked on this OS"
      ;;
  esac
  script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
  extension_dir=""
  for candidate in \
    "$script_dir/../apps/desktop/resources/extensions/1password" \
    "$script_dir/../resources/extensions/1password"
  do
    if [ -f "$candidate/manifest.json" ]; then
      extension_dir=$candidate
      break
    fi
  done
  if [ -n "$extension_dir" ]; then
    check_row extension pass ""
  else
    check_row extension fail "not downloaded"
  fi
}

if [ "$CHECK" = 1 ]; then
  report_check
  echo "This check does not install anything and does not use sudo."
  exit "$CHECK_STATUS"
fi

linux_family() {
  id=unknown
  like=""
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    id=$(. /etc/os-release && printf '%s' "${ID:-unknown}")
    like=$(. /etc/os-release && printf '%s' "${ID_LIKE:-}")
  fi
  case " $id $like " in
    *\ arch\ * | *\ omarchy\ *) printf 'arch' ;;
    *debian* | *ubuntu*) printf 'debian' ;;
    *fedora* | *rhel*) printf 'fedora' ;;
    *) printf 'other' ;;
  esac
}

print_linux_install() {
  echo "Linux family: $(linux_family)"
  case "$(linux_family)" in
    arch)
      if command -v yay >/dev/null 2>&1; then
        echo "Install: yay -S 1password 1password-cli"
      elif command -v paru >/dev/null 2>&1; then
        echo "Install: paru -S 1password 1password-cli"
      else
        echo "Install: yay -S 1password 1password-cli"
        echo "yay and paru are not installed, so those packages were not built."
      fi
      ;;
    debian)
      cat <<'EOF'
Install from 1Password's apt repository. These commands need a root prompt. They are not run from here.
  curl -sS https://downloads.1password.com/linux/keys/1password.asc | sudo gpg --dearmor --output /usr/share/keyrings/1password-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | sudo tee /etc/apt/sources.list.d/1password.list
  sudo mkdir -p /etc/debsig/policies/AC2D62742012EA22/
  curl -sS https://downloads.1password.com/linux/debian/debsig/1password.pol | sudo tee /etc/debsig/policies/AC2D62742012EA22/1password.pol
  sudo mkdir -p /usr/share/debsig/keyrings/AC2D62742012EA22
  curl -sS https://downloads.1password.com/linux/keys/1password.asc | sudo gpg --dearmor --output /usr/share/debsig/keyrings/AC2D62742012EA22/debsig.gpg
  sudo apt update && sudo apt install 1password 1password-cli
EOF
      ;;
    fedora)
      cat <<'EOF'
Install from 1Password's rpm repository. These commands need a root prompt. They are not run from here.
  sudo rpm --import https://downloads.1password.com/linux/keys/1password.asc
  sudo sh -c 'echo -e "[1password]\nname=1Password Stable Channel\nbaseurl=https://downloads.1password.com/linux/rpm/stable/\$basearch\nenabled=1\ngpgcheck=1\nrepo_gpgcheck=1\ngpgkey=https://downloads.1password.com/linux/keys/1password.asc" > /etc/yum.repos.d/1password.repo'
  sudo dnf install 1password 1password-cli
EOF
      ;;
    *)
      echo "Install from https://downloads.1password.com (apt, rpm, or the Arch package)."
      ;;
  esac
  echo "This run did not install packages."
}

fetch_extension() {
  script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
  fetch="$script_dir/../apps/desktop/scripts/fetch-devtools-extensions.mjs"
  if ! command -v node >/dev/null 2>&1 || [ ! -f "$fetch" ]; then
    echo "extension: skipped (node or the fetch script is not available)"
    return 0
  fi
  node "$fetch" --only 1password || echo "extension: fetch failed"
}

os=$(uname -s)
echo "1Password for Arbora. In the app, open Settings, Developer, and turn on Integrate with 1Password CLI."
echo "On Linux, also turn on Settings, Security, Unlock using system authentication."
echo "Browser integration lets the extension fill pages. Arbora's agent uses the op command."

if [ "$UNINSTALL" = 1 ]; then
  echo "Uninstall is left to the package manager so a shared 1Password install is not removed by surprise."
  case "$os" in
    Darwin) echo "  brew uninstall --cask 1password 1password-cli" ;;
    Linux) echo "  Remove the 1password and 1password-cli packages with apt, dnf, or pacman." ;;
    *) echo "  Settings → Apps → 1Password, and 1Password CLI." ;;
  esac
  exit 0
fi

fetch_extension

case "$os" in
  Darwin)
    echo "Install: brew install --cask 1password 1password-cli"
    if [ "$YES" = 1 ] && command -v brew >/dev/null 2>&1; then
      brew install --cask 1password 1password-cli
    fi
    ;;
  Linux)
    print_linux_install
    echo "Then allow Arbora to talk to 1Password. Add these names, one per line, to"
    echo "/etc/1password/custom_allowed_browsers (the packaged app is arbora, pnpm dev is electron):"
    echo "  arbora"
    echo "  electron"
    if [ "$YES" = 1 ] && [ -t 0 ]; then
      printf 'Write those names with sudo? [y/N] '
      read -r answer
      if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        sudo mkdir -p /etc/1password
        sudo touch /etc/1password/custom_allowed_browsers
        for name in arbora electron; do
          if ! sudo grep -qx "$name" /etc/1password/custom_allowed_browsers; then
            printf '%s\n' "$name" | sudo tee -a /etc/1password/custom_allowed_browsers >/dev/null
          fi
        done
      else
        echo "Left /etc/1password/custom_allowed_browsers unchanged."
      fi
    else
      echo "Not writing that file. Run this in a terminal and confirm before it uses sudo."
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "Install: winget install AgileBits.1Password AgileBits.1Password.CLI"
    if [ "$YES" = 1 ] && command -v winget >/dev/null 2>&1; then
      winget install AgileBits.1Password AgileBits.1Password.CLI
    fi
    ;;
  *)
    echo "Install 1Password and the op CLI from https://developer.1password.com/docs/cli/get-started/"
    ;;
esac

echo "Verification:"
report_check
