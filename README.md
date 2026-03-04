# ST 资源管理器（Termux + Vault）

这是一个本地运行的 SillyTavern 资源管理 WebApp。  
目标是无需打开 SillyTavern，也能完成资源管理、插件安装、导入导出、文件编辑、Vault 素材管理。

## 功能概览
- 多实例管理（默认 `~/SillyTavern`，支持自定义路径）
- 文件树浏览与文本编辑（JSON 自动校验）
- 自动备份与回滚
- SillyTavern 运行时写入排队
- ZIP 导入导出（实例库 + Vault）
- 插件安装（ZIP / Git）
- Git 同步（实例 / Vault：`clone`、`commit`、`pull`、`push`）
- Vault 素材库（收藏、取用、删除）
- 认证系统（首次设密、登录会话、改密、认证开关）
- 扫描缓存 + 增量刷新 + 分页查询

## 环境要求
- Node.js `>= 22`
- npm
- Git
- Termux（推荐）

## 配置流程（从 0 到可用）

### 1. 获取代码（新手版）
1. 先准备“仓库地址”（就是项目的下载地址）。
在 GitHub/Gitee 项目页面点击 `Code`，复制 HTTPS 地址。

示例地址（请替换成你自己的真实地址）：
```text
https://github.com/你的用户名/st-resource-manager.git
```

2. 打开 Termux，先回到 Home 目录：
```bash
cd ~
```

3. 执行克隆命令（把下面地址替换成你的仓库地址）：
```bash
git clone https://github.com/你的用户名/st-resource-manager.git st-resource-manager
```

4. 进入项目目录：
```bash
cd st-resource-manager
```

5. 检查是否成功（能看到 `package.json`、`README.md` 就是成功）：
```bash
ls
```

常见报错处理：
- `git: command not found`：先安装 Git，执行 `pkg install git`。
- `Repository not found`：仓库地址写错，或私有仓库没有权限。
- `destination path 'st-resource-manager' already exists`：目录已存在，换一个目录名或先删除旧目录。

### 2. 安装与构建
方式 A：一键脚本（Termux 推荐）
```bash
bash scripts/install-termux.sh
```

方式 B：手动命令
```bash
npm install
npm run build
```

### 3. 启动服务
方式 A：脚本启动
```bash
bash scripts/start.sh
```

方式 B：手动启动
```bash
npm run start
```

默认访问地址：
`http://127.0.0.1:3888`

### 4. 首次认证配置
1. 首次打开页面时，系统会要求设置访问密码。  
2. 设置后自动进入系统，并保存登录会话。  
3. 后续可在“设置”页执行：
- 修改密码
- 启用/关闭认证（可随时切换）

## 实例配置流程
1. 进入页面顶部实例区域。  
2. 默认会有一个实例，路径通常是 `~/SillyTavern`。  
3. 如需新增实例，填写：
- 实例名称
- 实例根目录  
4. 点击“新增实例”，然后在下拉框切换实例。

## Vault 配置流程
1. 打开 `Vault` 标签页。  
2. 可通过两种方式导入素材：
- ZIP 导入
- 本地路径导入  
3. 设置“取用目标目录”（相对实例根目录）。  
4. 点击“取用”即可将素材复制到当前实例目录（一次性复制，互不影响）。

## 扫描缓存与增量刷新说明
扫描页支持 3 种模式：
- `缓存查询`：仅查询当前缓存，速度最快。
- `增量刷新`：仅重扫变化分段，推荐日常使用。
- `全量刷新`：重扫所有分段，适合首次构建缓存或大规模改动后。

推荐使用顺序：
1. 第一次用 `全量刷新`
2. 日常用 `增量刷新`
3. 翻页查看用 `缓存查询`

## 常用开发命令
```bash
npm run dev
npm run build
npm run start
npm run test
```

## 数据目录
- `~/.st-resource-manager/config/instances.json`
- `~/.st-resource-manager/config/security.json`
- `~/.st-resource-manager/state/write-queue.json`
- `~/.st-resource-manager/state/scan-cache.json`
- `~/.st-resource-manager/backups/`
- `~/.st-resource-manager/repos/`
- `~/.st-resource-manager/vault/`
- `~/.st-resource-manager/audit/actions.log`

如需修改数据根目录，设置环境变量：
`ST_MANAGER_HOME=/path/to/custom/data`

## 常见问题
- 启动失败：先执行 `npm run build` 再 `npm run start`。
- 无法访问页面：确认地址是 `127.0.0.1:3888`，端口未被占用。
- 登录失败：确认密码正确；改密后需要重新登录。
- 扫描结果不更新：在扫描页切换到 `全量刷新` 再执行一次。

## 核心 API（简表）
- 认证：`/api/auth/*`
- 实例：`/api/instances/*`
- 队列：`/api/queue/*`
- 备份：`/api/backups/*`
- Vault：`/api/vault/*`

