#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_SCRIPT="$PROJECT_DIR/scripts/termux-oneclick.sh"

ensure_target_script() {
  if [ -f "$TARGET_SCRIPT" ]; then
    return 0
  fi

  echo "检测到 scripts/termux-oneclick.sh 不存在，尝试自动修复..."

  if ! command -v git >/dev/null 2>&1; then
    echo "未安装 git，无法自动修复。请先执行: pkg install git -y"
    return 1
  fi

  if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "当前目录不是 Git 仓库，无法自动拉取更新。"
    return 1
  fi

  if ! git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1; then
    echo "未配置 origin 远端，无法自动拉取更新。"
    return 1
  fi

  local dirty
  dirty="$(git -C "$PROJECT_DIR" status --porcelain 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "本地有未提交改动，已跳过自动拉取（避免覆盖本地修改）。"
    return 1
  fi

  git -C "$PROJECT_DIR" fetch --quiet --prune --all || true
  git -C "$PROJECT_DIR" pull --ff-only || true

  if [ -f "$TARGET_SCRIPT" ]; then
    echo "自动修复成功，继续执行一键脚本。"
    return 0
  fi

  echo "自动修复失败：仍未找到 scripts/termux-oneclick.sh"
  echo "请执行以下命令重新拉取完整项目："
  echo "  cd ~"
  echo "  rm -rf st-resource-manager"
  echo "  git clone https://github.com/qishiwan16-hub/termuxsillytavern.git st-resource-manager"
  echo "  cd st-resource-manager"
  echo "  bash termux-oneclick.sh"
  return 1
}

ensure_target_script
exec bash "$TARGET_SCRIPT" "$@"
