#!/usr/bin/env bash
# Launch ete-stethic in Tauri dev mode (vite + tauri, hot reload).
set -euo pipefail

cd "$(dirname "$0")"

# Tuxedo OS ships with fs.inotify.max_user_instances=128, which trips
# `tauri dev` on this repo. Warn (don't fail) if the limit looks low.
LIMIT=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo 0)
if [[ "$LIMIT" -lt 1024 ]]; then
  echo "⚠  fs.inotify.max_user_instances is $LIMIT — Tauri may crash."
  echo "   Bump it for this session with:"
  echo "     sudo sysctl fs.inotify.max_user_instances=8192"
  echo
fi

exec npm run tauri dev
