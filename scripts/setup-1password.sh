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

if [ "$CHECK" = 1 ]; then
  if op_status; then
    status=0
  else
    status=1
  fi
  echo "This check does not install anything and does not use sudo."
  exit "$status"
fi

os=$(uname -s)
echo "1Password for Arbora. Turn on Integrate with 1Password CLI in the 1Password app."
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

case "$os" in
  Darwin)
    echo "Install: brew install --cask 1password 1password-cli"
    if [ "$YES" = 1 ] && command -v brew >/dev/null 2>&1; then
      brew install --cask 1password 1password-cli
    fi
    ;;
  Linux)
    echo "Install from https://downloads.1password.com (apt, rpm, or the Arch package)."
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

echo "When op is on your PATH, pnpm setup:1password --check should print its version."
