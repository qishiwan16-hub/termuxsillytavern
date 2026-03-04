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

mkdir -p "$RUNTIME_DIR"

if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
fi

if [ -n "${ST_AUTO_OPEN:-}" ]; then
  AUTO_OPEN="$ST_AUTO_OPEN"
fi

save_config() {
  cat > "$CONFIG_FILE" <<EOF
AUTO_OPEN=${AUTO_OPEN}
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

  if is_pid_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "服务已在后台运行，PID=$pid"
    echo "访问地址：$APP_URL"
    open_app_url
    exit 0
  fi

  rm -f "$PID_FILE"

  echo "[1/4] 检查 Termux 依赖"
  ensure_termux_dependencies

  echo "[2/4] 准备项目依赖"
  ensure_project_dependencies

  echo "[3/4] 后台启动服务"
  nohup env HOST="$HOST" PORT="$PORT" node dist/server/index.js >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "启动失败，请查看日志：$LOG_FILE"
    exit 1
  fi

  echo "[4/4] 等待服务就绪"
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
    if [ "${2:-}" != "auto-open" ]; then
      echo "用法: bash scripts/termux-oneclick.sh config auto-open [on|off|show]"
      exit 1
    fi
    config_auto_open "${3:-show}"
    ;;
  *)
    echo "用法: bash scripts/termux-oneclick.sh [start|stop|restart|status|logs|config]"
    exit 1
    ;;
esac
