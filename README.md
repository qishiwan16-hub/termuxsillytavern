# ST 资源管理器（Termux + Vault）

一个本地运行的 SillyTavern 资源管理 WebApp。  
目标是不用打开 SillyTavern，也能完成资源管理、插件安装、导入导出、文件编辑与 Vault 素材库取用。

## 主要特性
- 多实例管理（默认 `~/SillyTavern`，可自定义路径）
- 资源树浏览、资源扫描分类统计
- 文本文件编辑（JSON 校验）
- 自动备份与回滚（每资源最多 10 份）
- SillyTavern 运行中写入排队，停止后自动执行
- ZIP 导入导出
- 插件安装（ZIP / Git）
- Git 镜像仓库同步（commit / pull / push）
- 独立 Vault 素材库（标签搜索、收藏、一键复制取用）
- 仅监听 `127.0.0.1`

## 快速开始（Termux）
```bash
git clone <your-repo-url> st-resource-manager
cd st-resource-manager
bash scripts/install-termux.sh
bash scripts/start.sh
```

浏览器打开：
`http://127.0.0.1:3888`

## 开发命令
```bash
npm install
npm run dev
npm run build
npm run start
npm run test
```

## 数据目录
- `~/.st-resource-manager/config/instances.json`
- `~/.st-resource-manager/state/write-queue.json`
- `~/.st-resource-manager/backups/`
- `~/.st-resource-manager/repos/`
- `~/.st-resource-manager/vault/`
- `~/.st-resource-manager/audit/actions.log`

可通过环境变量修改根目录：
`ST_MANAGER_HOME=/path/to/custom/data`

## 安全策略
- 所有读写路径先做 `realpath` 与根目录边界校验
- 拒绝路径穿越（`..`）
- 默认仅本机访问（`127.0.0.1`）
- 大文件默认只读预览

## 已实现 API（核心）
- `GET /api/instances`
- `POST /api/instances`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/scan`
- `GET /api/instances/:id/tree`
- `GET /api/instances/:id/file`
- `PUT /api/instances/:id/file`
- `POST /api/instances/:id/import/zip`
- `POST /api/instances/:id/export/zip`
- `POST /api/instances/:id/plugins/install`
- `POST /api/instances/:id/git/clone`
- `POST /api/instances/:id/git/commit`
- `POST /api/instances/:id/git/pull`
- `POST /api/instances/:id/git/push`
- `GET /api/queue`
- `POST /api/queue/:id/cancel`
- `GET /api/backups`
- `POST /api/backups/restore`
- `GET /api/vault/items`
- `POST /api/vault/import/zip`
- `POST /api/vault/import/path`
- `POST /api/vault/export/zip`
- `POST /api/vault/items/:id/apply`
- `PATCH /api/vault/items/:id/meta`
- `DELETE /api/vault/items/:id`
- `POST /api/vault/git/clone`
- `POST /api/vault/git/commit`
- `POST /api/vault/git/pull`
- `POST /api/vault/git/push`

## 说明
这是首版可运行实现，重点先覆盖你要求的完整主流程。  
如果要继续强化生产稳定性，下一步建议补充：权限鉴权、增量扫描、冲突合并策略、E2E 自动化。
