#!/usr/bin/env bash
# Sync the web build (web/) into the Swift Playgrounds wrapper (ACTIGWeb.swiftpm/WebApp/).
# ACTIGWeb.swiftpm bundles a copy of the web app; run this after changing web/ so the
# two never drift. CI (.github/workflows/sync-web-wrapper.yml) runs this with --check.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="web"
DEST="ACTIGWeb.swiftpm/WebApp"
ITEMS=(index.html manifest.webmanifest sw.js css js icons vendor)

check_only=false
[[ "${1:-}" == "--check" ]] && check_only=true

rm -rf "$DEST"
mkdir -p "$DEST"
for item in "${ITEMS[@]}"; do
  cp -R "$SRC/$item" "$DEST/"
done

if $check_only; then
  if [[ -n "$(git status --porcelain "$DEST")" ]]; then
    echo "::error::$DEST is out of sync with $SRC. Run scripts/sync-web-wrapper.sh and commit." >&2
    git --no-pager diff --stat "$DEST" >&2
    exit 1
  fi
  echo "OK: $DEST is in sync with $SRC."
else
  echo "Synced $SRC -> $DEST."
fi
