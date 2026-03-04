#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[1/4] 检查依赖"
command -v node >/dev/null 2>&1 || { echo "未找到 node"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "未找到 npm"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "未找到 git"; exit 1; }

echo "[2/4] 安装依赖"
npm install

echo "[3/4] 构建前后端"
npm run build

echo "[4/4] 完成"
echo "执行 ./scripts/start.sh 启动服务"
