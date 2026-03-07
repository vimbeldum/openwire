#!/usr/bin/env bash
# Ruflo post-task hook — auto-commit and push
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Safety: never stage secrets or env files
git add .
git reset -- '*.env' '.env.*' '**/*.env' '**/secrets*' '**/credentials*' 2>/dev/null || true

# Only commit if there are staged changes
if git diff --cached --quiet; then
  echo "[post-task] Nothing to commit — skipping."
  exit 0
fi

git commit -m "Auto-pushed by Ruflo swarm"
git push origin HEAD

echo "[post-task] Committed and pushed successfully."
