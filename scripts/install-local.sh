#!/usr/bin/env bash
# Installs a Linux desktop launcher that runs Arbora from this checkout (see scripts/arbora-local).
# Re-run after moving the checkout. Remove with: scripts/install-local.sh --uninstall
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
bin="$HOME/.local/bin/arbora"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
entry="$data/applications/arbora.desktop"
icon="$data/icons/hicolor/scalable/apps/arbora.svg"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$bin" "$entry" "$icon"
  update-desktop-database "$data/applications" 2>/dev/null || true
  echo "Removed the Arbora launcher."
  exit 0
fi

mkdir -p "$(dirname "$bin")" "$(dirname "$entry")" "$(dirname "$icon")"
chmod +x "$repo/scripts/arbora-local"
ln -sfn "$repo/scripts/arbora-local" "$bin"
cp "$repo/apps/desktop/build/icon.svg" "$icon"

cat >"$entry" <<EOF
[Desktop Entry]
Type=Application
Name=Arbora
GenericName=Design Mode for Agents
Comment=Browser, terminal and coding agents for a project, side by side
Exec="$bin" %f
Icon=arbora
Terminal=false
Categories=Development;IDE;
StartupWMClass=arbora
StartupNotify=true
EOF

update-desktop-database "$data/applications" 2>/dev/null || true
gtk-update-icon-cache -q "$data/icons/hicolor" 2>/dev/null || true
echo "Installed: $entry -> $bin -> $repo/scripts/arbora-local"
