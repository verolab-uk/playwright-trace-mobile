#!/usr/bin/env bash
# Upgrades the upstream sources the trace viewer builds from to microsoft/playwright
# at <ref> (tag, branch or commit). Upstream changes are merged into our files three-way,
# so local changes are kept; overlapping edits are left as conflict markers.
#
# Usage: scripts/sync-upstream.sh v1.64.0
set -euo pipefail

ref=${1:?usage: $0 <upstream-ref>}
root=$(git rev-parse --show-toplevel)
old=$(cut -d' ' -f2 "$root/UPSTREAM")
paths=(
  LICENSE
  NOTICE
  packages/trace-viewer
  packages/web
  packages/isomorphic
  packages/injected/src
  packages/playwright/src/isomorphic
  packages/playwright/src/reporters/reporterV2.ts
  packages/playwright/types/test.d.ts
  packages/playwright/types/testReporter.d.ts
  packages/protocol/src
  packages/recorder/src/recorderTypes.d.ts
)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
up() { git -C "$tmp" "$@"; }

up init --quiet
up remote add origin https://github.com/microsoft/playwright.git
up fetch --quiet --depth 1 --filter=blob:none origin "$old"
up fetch --quiet --depth 1 --filter=blob:none origin "$ref"
new=$(up rev-parse FETCH_HEAD)

conflicts=()
while IFS=$'\t' read -r status file; do
  ours="$root/$file"
  case "$status" in
    A)
      mkdir -p "$(dirname "$ours")"
      up show "$new:$file" > "$ours"
      ;;
    D)
      rm -f "$ours"
      ;;
    *)
      up show "$old:$file" > "$tmp/base"
      up show "$new:$file" > "$tmp/theirs"
      if [[ ! -f "$ours" ]] || cmp -s "$ours" "$tmp/base"; then
        mkdir -p "$(dirname "$ours")"
        cp "$tmp/theirs" "$ours"
      elif ! git merge-file -L ours -L "upstream $(cut -d' ' -f1 "$root/UPSTREAM")" -L "upstream $ref" "$ours" "$tmp/base" "$tmp/theirs"; then
        conflicts+=("$file")
      fi
      ;;
  esac
done < <(up diff --no-renames --name-status "$old" "$new" -- "${paths[@]}")

echo "$ref $new" > "$root/UPSTREAM"
if [[ "$ref" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  (cd "$root" && npm pkg set "devDependencies.@playwright/test=${BASH_REMATCH[1]}")
fi

echo "Synced upstream $ref ($new)."
if (( ${#conflicts[@]} )); then
  printf 'Resolve conflicts in:\n'
  printf '  %s\n' "${conflicts[@]}"
  exit 1
fi
