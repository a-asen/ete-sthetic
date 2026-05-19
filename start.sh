#!/usr/bin/env bash
# Launch ete-stethic in Tauri dev mode (vite + tauri, hot reload).
set -euo pipefail

cd "$(dirname "$0")"

# Dev server port. Default 5173; set PORT to run multiple instances side by
# side (e.g. `PORT=5174 ./start.sh` from a second worktree, alongside the
# main app on 5173). VITE_PORT is read by vite.config.ts; Tauri's devUrl is
# patched to match via --config so the two stay in sync without editing
# tauri.conf.json.
PORT="${PORT:-5173}"
export VITE_PORT="$PORT"

# Tuxedo OS ships with fs.inotify.max_user_instances=128, which trips
# `tauri dev` on this repo. Warn (don't fail) if the limit looks low.
LIMIT=$(cat /proc/sys/fs/inotify/max_user_instances 2>/dev/null || echo 0)
if [[ "$LIMIT" -lt 1024 ]]; then
  echo "⚠  fs.inotify.max_user_instances is $LIMIT — Tauri may crash."
  echo "   Bump it for this session with:"
  echo "     sudo sysctl fs.inotify.max_user_instances=8192"
  echo
fi

echo "▶  starting ete-stethic on http://localhost:${PORT}"
exec npm run tauri dev -- --config "{\"build\":{\"devUrl\":\"http://localhost:${PORT}\"}}"
