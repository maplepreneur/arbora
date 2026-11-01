#!/usr/bin/env bash
# /usr/bin/arbora from the arbora-bin package. Extra Chromium switches go in ARBORA_FLAGS (for
# example `--disable-gpu-sandbox` on NVIDIA) or in ~/.config/arbora-flags.conf, one per line.
set -euo pipefail

flags_file="${XDG_CONFIG_HOME:-$HOME/.config}/arbora-flags.conf"
extra=()
if [[ -f "$flags_file" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    extra+=("$line")
  done <"$flags_file"
fi

exec /opt/arbora/arbora --class=arbora "${extra[@]}" "$@"
