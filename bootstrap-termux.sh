#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ACTION="${1:-start}"
if [ "$#" -gt 0 ]; then
  shift
fi

REPO_URL="${ST_REPO_URL:-https://github.com/qishiwan16-hub/termuxsillytavern.git}"
INSTALL_DIR="${ST_INSTALL_DIR:-$HOME/st-resource-manager}"
BRANCH="${ST_BRANCH:-main}"

log() {
  printf '%s\n' "$1"
}

ensure_termux() {
  if ! command -v pkg >/dev/null 2>&1; then
    log "Error: pkg not found. Please run this script inside Termux."
    exit 1
  fi
}

ensure_git() {
  if ! command -v git >/dev/null 2>&1; then
    log "[deps] Installing git ..."
    pkg install -y git
  fi
}

clone_or_update_repo() {
  mkdir -p "$(dirname "$INSTALL_DIR")"

  if [ -d "$INSTALL_DIR/.git" ]; then
    log "[repo] Existing install found, updating ..."
    git -C "$INSTALL_DIR" fetch --prune origin || true
    git -C "$INSTALL_DIR" checkout "$BRANCH" || true
    git -C "$INSTALL_DIR" pull --ff-only || true
    return
  fi

  if [ -d "$INSTALL_DIR" ]; then
    log "Error: $INSTALL_DIR exists but is not a git repository."
    log "Fix: remove this directory or set ST_INSTALL_DIR to another path."
    exit 1
  fi

  log "[repo] Cloning $REPO_URL -> $INSTALL_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
}

run_oneclick() {
  local target="$INSTALL_DIR/scripts/termux-oneclick.sh"
  if [ ! -f "$target" ]; then
    log "Error: missing $target"
    exit 1
  fi

  log "[run] bash scripts/termux-oneclick.sh $ACTION"
  cd "$INSTALL_DIR"
  exec bash "$target" "$ACTION" "$@"
}

ensure_termux
ensure_git
clone_or_update_repo
run_oneclick "$@"
