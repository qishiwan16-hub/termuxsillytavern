#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

if [ ! -f "dist/server/index.js" ]; then
  echo "缺少 dist/server/index.js，无法快速启动。"
  echo "请先执行 npm run build（当前仓库需具备可构建环境）"
  exit 1
fi

if [ ! -f "dist/client/index.html" ]; then
  echo "缺少 dist/client/index.html，无法快速启动。"
  echo "请先执行 npm run build（当前仓库需具备可构建环境）"
  exit 1
fi

echo "[1/2] 安装运行时依赖（跳过 dev 依赖）"
npm install --omit=dev

echo "[2/2] 启动服务"
exec node dist/server/index.js
