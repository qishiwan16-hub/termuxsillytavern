#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

ACTION="${1:-start}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

RUNTIME_DIR="$PROJECT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/st-manager.pid"
LOG_FILE="$RUNTIME_DIR/st-manager.log"
CONFIG_FILE="$RUNTIME_DIR/oneclick.conf"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3888}"
APP_URL="http://${HOST}:${PORT}"

AUTO_OPEN="0"
AUTO_UPDATE="1"
REPO_UPDATED="0"

APP_DATA_ROOT="${ST_MANAGER_HOME:-$HOME/.st-resource-manager}"

ensure_runtime_dir() {
  mkdir -p "$RUNTIME_DIR"
}

load_config() {
  if [ -f "$CONFIG_FILE" ]; then
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
  fi

  if [ -n "${ST_AUTO_OPEN:-}" ]; then
    AUTO_OPEN="$ST_AUTO_OPEN"
  fi
  if [ -n "${ST_AUTO_UPDATE:-}" ]; then
    AUTO_UPDATE="$ST_AUTO_UPDATE"
  fi
}

save_config() {
  cat > "$CONFIG_FILE" <<EOF
AUTO_OPEN=${AUTO_OPEN}
AUTO_UPDATE=${AUTO_UPDATE}
EOF
}

ensure_first_install_dirs() {
  mkdir -p "$PROJECT_DIR"
  mkdir -p "$RUNTIME_DIR"

  mkdir -p "$APP_DATA_ROOT/config"
  mkdir -p "$APP_DATA_ROOT/state"
  mkdir -p "$APP_DATA_ROOT/backups"
  mkdir -p "$APP_DATA_ROOT/repos"
  mkdir -p "$APP_DATA_ROOT/vault/files"
  mkdir -p "$APP_DATA_ROOT/trash"
  mkdir -p "$APP_DATA_ROOT/audit"

  touch "$APP_DATA_ROOT/config/instances.json"
  touch "$APP_DATA_ROOT/config/security.json"
  touch "$APP_DATA_ROOT/config/app-settings.json"
  touch "$APP_DATA_ROOT/state/write-queue.json"
  touch "$APP_DATA_ROOT/state/scan-cache.json"
  touch "$APP_DATA_ROOT/state/trash-index.json"
  touch "$APP_DATA_ROOT/vault/meta.json"
  touch "$APP_DATA_ROOT/audit/actions.log"
}

is_pid_running() {
  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

is_service_ready() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi
  curl -fsS "${APP_URL}/api/health" >/dev/null 2>&1
}

open_app_url() {
  if [ "$AUTO_OPEN" != "1" ]; then
    return
  fi
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$APP_URL" >/dev/null 2>&1 || true
  fi
}

prompt_auto_open_if_needed() {
  if [ -f "$CONFIG_FILE" ]; then
    return
  fi

  if [ ! -t 0 ]; then
    save_config
    return
  fi

  echo "First run: enable auto-open browser after start? [y/N]"
  read -r answer
  case "${answer:-}" in
    y|Y|yes|YES)
      AUTO_OPEN="1"
      ;;
    *)
      AUTO_OPEN="0"
      ;;
  esac
  save_config
}

ensure_termux_dependencies() {
  if ! command -v pkg >/dev/null 2>&1; then
    echo "pkg not found. Please run in Termux."
    exit 1
  fi

  local missing=0
  command -v git >/dev/null 2>&1 || missing=1
  command -v node >/dev/null 2>&1 || missing=1
  command -v npm >/dev/null 2>&1 || missing=1
  command -v curl >/dev/null 2>&1 || missing=1

  if [ "$missing" -eq 1 ]; then
    echo "[deps] Installing git/node/curl ..."
    pkg install -y git nodejs-lts curl
  fi
}

auto_update_repo() {
  if [ "$AUTO_UPDATE" != "1" ]; then
    echo "[update] disabled"
    return
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "[update] git not found, skip"
    return
  fi

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[update] current dir is not a git repo, skip"
    return
  fi

  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "[update] origin is missing, skip"
    return
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    echo "[update] detached head, skip"
    return
  fi

  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    echo "[update] upstream not configured, skip"
    return
  fi

  local dirty
  dirty="$(git status --porcelain 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "[update] local changes found, skip auto-pull"
    return
  fi

  echo "[update] checking remote ..."
  if ! git fetch --quiet --prune --all; then
    echo "[update] fetch failed, continue with local code"
    return
  fi

  local local_sha remote_sha base_sha
  local_sha="$(git rev-parse @)"
  remote_sha="$(git rev-parse '@{u}')"
  base_sha="$(git merge-base @ '@{u}')"

  if [ "$local_sha" = "$remote_sha" ]; then
    echo "[update] already up to date"
    return
  fi

  if [ "$local_sha" = "$base_sha" ]; then
    echo "[update] new commits found, running git pull --ff-only"
    if git pull --ff-only; then
      REPO_UPDATED="1"
      echo "[update] updated"
    else
      echo "[update] auto update failed, run git pull manually"
    fi
    return
  fi

  if [ "$remote_sha" = "$base_sha" ]; then
    echo "[update] local branch is ahead, skip"
    return
  fi

  echo "[update] branch diverged, skip auto-pull"
}

ensure_project_dependencies() {
  needs_rebuild_from_sources
  if [ "$REPO_UPDATED" = "1" ] || [ "${ST_FORCE_REBUILD:-0}" = "1" ]; then
    echo "[project] install + build (repo updated or force rebuild)"
    npm install
    npm run build
    return
  fi

  if [ "${REBUILD_NEEDED:-0}" = "1" ]; then
    echo "[project] source changed since last build, rebuilding dist"
    if [ ! -d "node_modules" ] || [ "${ST_FORCE_INSTALL:-0}" = "1" ]; then
      npm install
    fi
    npm run build
    return
  fi

  if [ -f "dist/server/index.js" ] && [ -f "dist/client/index.html" ]; then
    if [ -d "node_modules" ] && [ "${ST_FORCE_INSTALL:-0}" != "1" ]; then
      echo "[project] dist and node_modules found, skip install/build"
    else
      echo "[project] dist found, install runtime deps"
      npm install --omit=dev
    fi
    return
  fi

  echo "[project] dist missing, run full install + build"
  npm install
  npm run build
}

needs_rebuild_from_sources() {
  REBUILD_NEEDED="0"
  if [ ! -f "dist/server/index.js" ] || [ ! -f "dist/client/index.html" ]; then
    REBUILD_NEEDED="1"
    return
  fi

  local latest_src latest_dist
  latest_src="$(
    {
      find src -type f 2>/dev/null || true
      find server -type f 2>/dev/null || true
      find scripts -type f 2>/dev/null || true
      [ -f package.json ] && printf '%s\n' package.json
      [ -f tsconfig.server.json ] && printf '%s\n' tsconfig.server.json
      [ -f tsconfig.client.json ] && printf '%s\n' tsconfig.client.json
    } | xargs -r stat -c '%Y' 2>/dev/null | sort -nr | head -n 1
  )"

  latest_dist="$(
    {
      find dist/client -type f 2>/dev/null || true
      find dist/server -type f 2>/dev/null || true
    } | xargs -r stat -c '%Y' 2>/dev/null | sort -nr | head -n 1
  )"

  if [ -z "$latest_src" ] || [ -z "$latest_dist" ]; then
    REBUILD_NEEDED="1"
    return
  fi

  if [ "$latest_src" -gt "$latest_dist" ]; then
    REBUILD_NEEDED="1"
  fi
}

wait_until_ready() {
  local retries=25
  local i
  for i in $(seq 1 "$retries"); do
    if is_service_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

start_service() {
  ensure_first_install_dirs
  prompt_auto_open_if_needed

  echo "[1/5] check Termux dependencies"
  ensure_termux_dependencies

  echo "[2/5] check repository update"
  auto_update_repo

  if is_pid_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [ "$REPO_UPDATED" = "1" ]; then
      echo "Service is running and repo updated. Restarting service ..."
      stop_service
    else
      echo "Service already running. PID=$pid"
      echo "URL: $APP_URL"
      open_app_url
      exit 0
    fi
  fi

  rm -f "$PID_FILE"

  echo "[3/5] prepare project dependencies"
  ensure_project_dependencies

  echo "[4/5] start backend in background"
  nohup env HOST="$HOST" PORT="$PORT" ST_MANAGER_HOME="$APP_DATA_ROOT" node dist/server/index.js >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "Start failed. Check log: $LOG_FILE"
    exit 1
  fi

  echo "[5/5] wait for readiness"
  if wait_until_ready; then
    echo "Started: $APP_URL"
    echo "Data root: $APP_DATA_ROOT"
    echo "Log file: $LOG_FILE"
    open_app_url
  else
    echo "Service not ready in time. Check log: $LOG_FILE"
    exit 1
  fi
}

stop_service() {
  if ! is_pid_running; then
    rm -f "$PID_FILE"
    echo "Service not running"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE"
  echo "Service stopped"
}

show_status() {
  if is_pid_running; then
    echo "Running: PID=$(cat "$PID_FILE")"
    echo "URL: $APP_URL"
    echo "Data root: $APP_DATA_ROOT"
    return 0
  fi

  if is_service_ready; then
    echo "Service reachable but PID file missing: $APP_URL"
    echo "Data root: $APP_DATA_ROOT"
    return 0
  fi

  echo "Not running"
}

show_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "No log file yet: $LOG_FILE"
    return 0
  fi
  tail -n 120 "$LOG_FILE"
}

config_auto_open() {
  local mode="${1:-show}"
  case "$mode" in
    on)
      AUTO_OPEN="1"
      save_config
      echo "Auto-open set to: ON"
      ;;
    off)
      AUTO_OPEN="0"
      save_config
      echo "Auto-open set to: OFF"
      ;;
    show)
      if [ "$AUTO_OPEN" = "1" ]; then
        echo "Auto-open: ON"
      else
        echo "Auto-open: OFF"
      fi
      echo "Config file: $CONFIG_FILE"
      ;;
    *)
      echo "Usage: bash scripts/termux-oneclick.sh config auto-open [on|off|show]"
      exit 1
      ;;
  esac
}

config_auto_update() {
  local mode="${1:-show}"
  case "$mode" in
    on)
      AUTO_UPDATE="1"
      save_config
      echo "Auto-update set to: ON"
      ;;
    off)
      AUTO_UPDATE="0"
      save_config
      echo "Auto-update set to: OFF"
      ;;
    show)
      if [ "$AUTO_UPDATE" = "1" ]; then
        echo "Auto-update: ON"
      else
        echo "Auto-update: OFF"
      fi
      echo "Config file: $CONFIG_FILE"
      ;;
    *)
      echo "Usage: bash scripts/termux-oneclick.sh config auto-update [on|off|show]"
      exit 1
      ;;
  esac
}

init_dirs_only() {
  ensure_first_install_dirs
  echo "Init completed:"
  echo "  runtime: $RUNTIME_DIR"
  echo "  data root: $APP_DATA_ROOT"
}

ensure_runtime_dir
load_config

case "$ACTION" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  restart)
    stop_service
    start_service
    ;;
  status)
    show_status
    ;;
  logs)
    show_logs
    ;;
  init-dirs)
    init_dirs_only
    ;;
  config)
    case "${2:-}" in
      auto-open)
        config_auto_open "${3:-show}"
        ;;
      auto-update)
        config_auto_update "${3:-show}"
        ;;
      *)
        echo "Usage:"
        echo "  bash scripts/termux-oneclick.sh config auto-open [on|off|show]"
        echo "  bash scripts/termux-oneclick.sh config auto-update [on|off|show]"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Usage: bash scripts/termux-oneclick.sh [start|stop|restart|status|logs|init-dirs|config]"
    exit 1
    ;;
esac
