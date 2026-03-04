#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

export PORT="${PORT:-3888}"
export HOST="${HOST:-127.0.0.1}"

echo "启动 ST 资源管理器: http://${HOST}:${PORT}"
npm run start
