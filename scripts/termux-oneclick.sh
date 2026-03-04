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

mkdir -p "$RUNTIME_DIR"

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

save_config() {
  cat > "$CONFIG_FILE" <<EOF
AUTO_OPEN=${AUTO_OPEN}
AUTO_UPDATE=${AUTO_UPDATE}
EOF
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
  echo "是否开启启动后自动打开浏览器？[y/N]"
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

auto_update_repo() {
  if [ "$AUTO_UPDATE" != "1" ]; then
    echo "[更新] 自动更新已关闭"
    return
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "[更新] 未检测到 git，跳过自动更新"
    return
  fi

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[更新] 当前目录不是 Git 仓库，跳过自动更新"
    return
  fi

  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "[更新] 未配置 origin 远端，跳过自动更新"
    return
  fi

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    echo "[更新] 当前不是可跟踪分支，跳过自动更新"
    return
  fi

  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    echo "[更新] 当前分支未设置上游，跳过自动更新"
    return
  fi

  local dirty
  dirty="$(git status --porcelain 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "[更新] 检测到本地未提交修改，跳过自动拉取（避免覆盖本地改动）"
    return
  fi

  echo "[更新] 检查远端更新..."
  if ! git fetch --quiet --prune --all; then
    echo "[更新] 拉取远端信息失败，继续使用本地代码"
    return
  fi

  local local_sha remote_sha base_sha
  local_sha="$(git rev-parse @)"
  remote_sha="$(git rev-parse '@{u}')"
  base_sha="$(git merge-base @ '@{u}')"

  if [ "$local_sha" = "$remote_sha" ]; then
    echo "[更新] 已是最新版本"
    return
  fi

  if [ "$local_sha" = "$base_sha" ]; then
    echo "[更新] 检测到新版本，执行 fast-forward 更新"
    if git pull --ff-only; then
      REPO_UPDATED="1"
      echo "[更新] 更新完成"
    else
      echo "[更新] 自动更新失败，请手动执行 git pull"
    fi
    return
  fi

  if [ "$remote_sha" = "$base_sha" ]; then
    echo "[更新] 本地版本领先远端，跳过拉取"
    return
  fi

  echo "[更新] 本地与远端分叉，已跳过自动拉取，请手动处理合并"
}

ensure_termux_dependencies() {
  if ! command -v pkg >/dev/null 2>&1; then
    echo "未检测到 pkg，请确认当前环境是 Termux。"
    exit 1
  fi

  local missing=0
  command -v git >/dev/null 2>&1 || missing=1
  command -v node >/dev/null 2>&1 || missing=1
  command -v npm >/dev/null 2>&1 || missing=1
  command -v curl >/dev/null 2>&1 || missing=1

  if [ "$missing" -eq 1 ]; then
    echo "[依赖] 安装 Termux 基础依赖（git/node/curl）"
    pkg install -y git nodejs-lts curl
  fi
}

ensure_project_dependencies() {
  if [ "$REPO_UPDATED" = "1" ] || [ "${ST_FORCE_REBUILD:-0}" = "1" ]; then
    echo "[项目] 检测到仓库更新，执行依赖同步并重新构建"
    npm install
    npm run build
    return
  fi

  if [ -f "dist/server/index.js" ] && [ -f "dist/client/index.html" ]; then
    if [ -d "node_modules" ] && [ "${ST_FORCE_INSTALL:-0}" != "1" ]; then
      echo "[项目] 检测到预构建 dist，且 node_modules 已存在，跳过依赖安装"
    else
      echo "[项目] 检测到预构建 dist，安装运行时依赖"
      npm install --omit=dev
    fi
    return
  fi

  echo "[项目] 未检测到可用 dist，执行完整安装与构建"
  npm install
  npm run build
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
  prompt_auto_open_if_needed

  echo "[1/5] 检查 Termux 依赖"
  ensure_termux_dependencies

  echo "[2/5] 自动检查仓库更新"
  auto_update_repo

  if is_pid_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    if [ "$REPO_UPDATED" = "1" ]; then
      echo "检测到服务运行中且仓库已更新，自动重启服务应用新版本"
      stop_service
    else
      echo "服务已在后台运行，PID=$pid"
      echo "访问地址：$APP_URL"
      open_app_url
      exit 0
    fi
  fi

  rm -f "$PID_FILE"

  echo "[3/5] 准备项目依赖"
  ensure_project_dependencies

  echo "[4/5] 后台启动服务"
  nohup env HOST="$HOST" PORT="$PORT" node dist/server/index.js >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "启动失败，请查看日志：$LOG_FILE"
    exit 1
  fi

  echo "[5/5] 等待服务就绪"
  if wait_until_ready; then
    echo "启动成功：$APP_URL"
    echo "日志文件：$LOG_FILE"
    open_app_url
  else
    echo "服务未在预期时间内就绪，请查看日志：$LOG_FILE"
    exit 1
  fi
}

stop_service() {
  if ! is_pid_running; then
    rm -f "$PID_FILE"
    echo "服务未运行"
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
  echo "服务已停止"
}

show_status() {
  if is_pid_running; then
    echo "运行中：PID=$(cat "$PID_FILE")"
    echo "地址：$APP_URL"
    exit 0
  fi

  if is_service_ready; then
    echo "服务可访问，但未找到 PID 文件：$APP_URL"
    exit 0
  fi

  echo "未运行"
}

show_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    echo "暂无日志文件：$LOG_FILE"
    exit 0
  fi
  tail -n 120 "$LOG_FILE"
}

config_auto_open() {
  local mode="${1:-show}"
  case "$mode" in
    on)
      AUTO_OPEN="1"
      save_config
      echo "已开启自动跳转浏览器"
      ;;
    off)
      AUTO_OPEN="0"
      save_config
      echo "已关闭自动跳转浏览器"
      ;;
    show)
      if [ "$AUTO_OPEN" = "1" ]; then
        echo "自动跳转：开启"
      else
        echo "自动跳转：关闭"
      fi
      echo "配置文件：$CONFIG_FILE"
      ;;
    *)
      echo "用法: bash scripts/termux-oneclick.sh config auto-open [on|off|show]"
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
      echo "已开启自动更新检查"
      ;;
    off)
      AUTO_UPDATE="0"
      save_config
      echo "已关闭自动更新检查"
      ;;
    show)
      if [ "$AUTO_UPDATE" = "1" ]; then
        echo "自动更新：开启"
      else
        echo "自动更新：关闭"
      fi
      echo "配置文件：$CONFIG_FILE"
      ;;
    *)
      echo "用法: bash scripts/termux-oneclick.sh config auto-update [on|off|show]"
      exit 1
      ;;
  esac
}

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
  config)
    case "${2:-}" in
      auto-open)
        config_auto_open "${3:-show}"
        ;;
      auto-update)
        config_auto_update "${3:-show}"
        ;;
      *)
        echo "用法:"
        echo "  bash scripts/termux-oneclick.sh config auto-open [on|off|show]"
        echo "  bash scripts/termux-oneclick.sh config auto-update [on|off|show]"
        exit 1
        ;;
    esac
    ;;
  *)
    echo "用法: bash scripts/termux-oneclick.sh [start|stop|restart|status|logs|config]"
    exit 1
    ;;
esac
