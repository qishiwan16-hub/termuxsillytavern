#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[1/5] 检查依赖"
command -v node >/dev/null 2>&1 || { echo "未找到 node"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "未找到 npm"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "未找到 git"; exit 1; }

echo "[2/5] 安装依赖"
npm install

echo "[3/5] 构建前后端"
BUILD_LOG="$(mktemp)"
if npm run build 2>&1 | tee "$BUILD_LOG"; then
  echo "构建成功"
else
  if grep -q "native Rollup build" "$BUILD_LOG"; then
    echo "检测到 Rollup 原生包不支持当前 Termux 平台，切换为 WASM 版本后重试..."
    npm install --save-dev "rollup@npm:@rollup/wasm-node@^4.59.0"
    npm run build
  else
    echo "构建失败（非 Rollup 平台问题），请根据上方日志修复。"
    rm -f "$BUILD_LOG"
    exit 1
  fi
fi
rm -f "$BUILD_LOG"

echo "[4/5] 记录平台信息"
node -p "'platform=' + process.platform + ', arch=' + process.arch"

echo "[5/5] 完成"
echo "执行 ./scripts/start.sh 启动服务"
