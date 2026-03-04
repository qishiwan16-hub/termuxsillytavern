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

### -1. 云端一键拉取（首次安装推荐）
你本地还没有项目代码时，直接在 Termux 执行：
```bash
pkg install curl -y
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash
```

说明：
- 这条命令会自动把项目拉到 `~/st-resource-manager`（可用 `ST_INSTALL_DIR` 改路径）。
- 已有项目时会先尝试更新，再继续启动。
- 启动动作默认是 `start`。

可选：执行其他动作（例如 `status` / `logs` / `restart`）：
```bash
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- status
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- logs
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- restart
```

### 0. 一键启动（最简入口，推荐）
打开 Termux 后，直接执行：
```bash
cd ~/st-resource-manager
bash termux-oneclick.sh
```
等价命令：`bash scripts/termux-oneclick.sh`
脚本会自动完成：
- 检查并安装 Termux 依赖（git/node/curl）
- 自动检查 Git 远端更新并拉取（`git pull --ff-only`）
- 检测到更新后自动重新安装依赖并重建
- 无更新时自动判断是否需要构建（有 `dist` 则可跳过构建）
- 后台启动服务
- 首次启动会询问是否开启“自动跳转浏览器”

常用管理命令：
```bash
bash termux-oneclick.sh status
bash termux-oneclick.sh logs
bash termux-oneclick.sh stop
bash termux-oneclick.sh restart
bash termux-oneclick.sh config auto-open show
bash termux-oneclick.sh config auto-open on
bash termux-oneclick.sh config auto-open off
bash termux-oneclick.sh config auto-update show
bash termux-oneclick.sh config auto-update on
bash termux-oneclick.sh config auto-update off
```

如果你看到报错 `bash: scripts/termux-oneclick.sh: No such file or directory`：
```bash
cd ~/st-resource-manager
bash termux-oneclick.sh
```
`termux-oneclick.sh` 已内置自动修复：会先尝试 `git pull --ff-only` 补齐脚本。
如果自动修复失败，再执行完整重装：
```bash
cd ~
rm -rf st-resource-manager
git clone https://github.com/qishiwan16-hub/termuxsillytavern.git st-resource-manager
cd st-resource-manager
bash termux-oneclick.sh
```

### 1. 获取代码（这一步到底是做什么）
这一步的目的：把“当前这个 ST 资源管理器项目”下载到手机 Termux 本地。  
不是下载 SillyTavern 本体，也不是必须自己新建仓库。

是否需要你自己建仓库：
- 普通使用者：不需要。直接克隆本项目仓库即可。
- 你要二次开发并长期自己维护代码：才需要 fork 或新建自己的仓库。

#### 方式 A（推荐）：直接克隆当前项目
1. 在项目页面点击 `Code`，复制 HTTPS 地址（这是“当前项目”的地址）。

2. 如果你就是要安装“当前这个项目”，直接复制下面命令，不需要改任何内容：
```bash
cd ~
pkg install git -y
REPO_URL="https://github.com/qishiwan16-hub/termuxsillytavern.git"
git clone "$REPO_URL" st-resource-manager
cd st-resource-manager
ls
```

3. `ls` 输出里看到 `package.json`、`README.md`、`scripts` 说明获取成功。
4. 只有在你 fork 了自己的仓库时，才把 `REPO_URL` 改成你自己的地址。

#### 方式 B：你已经有项目文件（例如别人发给你的 ZIP）
1. 把 ZIP 解压到 Termux 的 Home 目录，解压后目录内必须有 `package.json`。
2. 进入目录（目录名按你的实际名称）：
```bash
cd ~/st-resource-manager
ls
```
3. 看到 `package.json` 即可继续下一步“安装与构建”。

常见报错处理：
- `git: command not found`：执行 `pkg install git -y` 安装 Git。
- `Repository not found`：你填的不是“当前项目”的仓库地址，或私有仓库无权限。
- `destination path 'st-resource-manager' already exists`：目录已存在，先删除旧目录或换目录名。

### 2. 安装与构建
方式 A：一键脚本（Termux 推荐，含自动更新检查 + 自动后台启动）
```bash
bash termux-oneclick.sh
```

方式 B：安装脚本（仅安装与构建）
```bash
bash scripts/install-termux.sh
```

方式 C：手动命令（构建链路已改为 esbuild，不走 Rollup）
```bash
npm install
npm run build
```

方式 D：快速启动（跳过构建）
```bash
bash scripts/start-quick.sh
```
适用场景：仓库已包含可用 `dist/` 时，直接安装运行时依赖并启动，不执行构建。

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
npm run termux:oneclick
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
- 构建时报错 `native Rollup build` / `throwUnsupportedError`：
  先执行 `git pull` 更新到最新代码。当前版本的 `build:client` 已改为 `esbuild`，正常不会再触发 Rollup 报错。
  更新后建议执行：
```bash
cd ~/st-resource-manager
npm install
npm run build
```
  仍想跳过构建时，使用：
```bash
bash scripts/start-quick.sh
```

## 核心 API（简表）
- 认证：`/api/auth/*`
- 实例：`/api/instances/*`
- 队列：`/api/queue/*`
- 备份：`/api/backups/*`
- Vault：`/api/vault/*`

