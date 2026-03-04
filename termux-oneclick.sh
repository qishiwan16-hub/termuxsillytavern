#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_SCRIPT="$PROJECT_DIR/scripts/termux-oneclick.sh"
DEFAULT_INSTALL_DIR="${ST_INSTALL_DIR:-$HOME/st-resource-manager}"
DEFAULT_REPO_URL="${ST_REPO_URL:-https://github.com/qishiwan16-hub/termuxsillytavern.git}"

repair_in_current_repo() {
  if [ -f "$TARGET_SCRIPT" ]; then
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    return 1
  fi

  if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 1
  fi

  echo "Missing scripts/termux-oneclick.sh, trying repo self-repair ..."

  local dirty
  dirty="$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "Local changes detected, skip auto-pull to avoid overwrite"
  else
    git -C "$PROJECT_DIR" fetch --quiet --prune --all || true
    git -C "$PROJECT_DIR" pull --ff-only || true
  fi

  [ -f "$TARGET_SCRIPT" ]
}

bootstrap_install_if_needed() {
  if [ -f "$TARGET_SCRIPT" ]; then
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "git not found, cannot auto-bootstrap first install"
    echo "Run: pkg install git -y"
    return 1
  fi

  echo "Current dir is not a complete project, bootstrap install to: $DEFAULT_INSTALL_DIR"
  mkdir -p "$(dirname "$DEFAULT_INSTALL_DIR")"

  if [ -d "$DEFAULT_INSTALL_DIR/.git" ]; then
    echo "Existing install found, update it ..."
    git -C "$DEFAULT_INSTALL_DIR" fetch --quiet --prune --all || true
    git -C "$DEFAULT_INSTALL_DIR" pull --ff-only || true
  elif [ -d "$DEFAULT_INSTALL_DIR" ]; then
    echo "Directory exists but is not a git repo: $DEFAULT_INSTALL_DIR"
    echo "Clean that directory first, or set ST_INSTALL_DIR to another path."
    return 1
  else
    echo "Cloning repository: $DEFAULT_REPO_URL"
    git clone "$DEFAULT_REPO_URL" "$DEFAULT_INSTALL_DIR"
  fi

  if [ ! -f "$DEFAULT_INSTALL_DIR/scripts/termux-oneclick.sh" ]; then
    echo "Bootstrap failed: scripts/termux-oneclick.sh not found in $DEFAULT_INSTALL_DIR"
    return 1
  fi

  echo "Bootstrap completed, hand over to project one-click script ..."
  exec bash "$DEFAULT_INSTALL_DIR/scripts/termux-oneclick.sh" "$@"
}

if [ -f "$TARGET_SCRIPT" ]; then
  exec bash "$TARGET_SCRIPT" "$@"
fi

if repair_in_current_repo; then
  exec bash "$TARGET_SCRIPT" "$@"
fi

bootstrap_install_if_needed "$@" || {
  echo "Auto repair/bootstrap failed."
  echo "Run manually:"
  echo "  cd ~"
  echo "  pkg install git -y"
  echo "  git clone $DEFAULT_REPO_URL st-resource-manager"
  echo "  cd st-resource-manager"
  echo "  bash termux-oneclick.sh"
  exit 1
}
