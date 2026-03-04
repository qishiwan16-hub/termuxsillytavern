# ST 资源管理器（Termux 版）

这是一个本地运行的 SillyTavern 资源管理 WebApp。  
目标：不打开酒馆也能管理资源、导入导出、编辑文件、管理 Vault 素材库。

## 先说结论（你最关心的）
1. 第一次安装，不需要本地先有项目文件。
2. 直接用“云端一键命令”即可自动拉取代码并启动。
3. 文档里所有命令都给了“一行复制版”（用 `&&` 串联）。

## 重点提醒（避免报错）
1. 在 Termux 里串联命令请用 `&&`，不要用单个 `&`。
2. `&&` 含义：上一条成功才执行下一条，更稳定。
3. `&` 含义：后台执行，容易导致你还没准备好就执行后续步骤。

---

## 0. 首次安装（云端一键，推荐）
直接复制这一行：

```bash
pkg install -y curl git && curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash
```

这条命令会自动做：
1. 安装基础依赖（curl/git）。
2. 拉取仓库到 `~/st-resource-manager`。
3. 调用一键脚本启动服务。

---

## 1. 常用一行命令（复制即用）

### 启动
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh start
```

### 重启
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh restart
```

### 停止
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh stop
```

### 查看状态
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh status
```

### 查看日志
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh logs
```

### 只初始化首次安装目录（不启动）
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh init-dirs
```

---

## 2. 自动打开浏览器（可选）

### 查看状态
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-open show
```

### 开启
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-open on
```

### 关闭
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-open off
```

---

## 3. 自动更新仓库（可选）

### 查看状态
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-update show
```

### 开启
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-update on
```

### 关闭
```bash
cd ~/st-resource-manager && bash termux-oneclick.sh config auto-update off
```

---

## 4. 访问地址
默认地址：

```text
http://127.0.0.1:3888
```

---

## 5. 如果你坚持手动安装（非必须）

### 一行克隆并进入目录
```bash
cd ~ && pkg install -y git && git clone https://github.com/qishiwan16-hub/termuxsillytavern.git st-resource-manager && cd st-resource-manager
```

### 一行安装并构建
```bash
cd ~/st-resource-manager && npm install && npm run build
```

### 一行启动
```bash
cd ~/st-resource-manager && npm run start
```

---

## 6. 常见报错与一行修复

### 报错：`No such file or directory`
```bash
cd ~/st-resource-manager && git pull --ff-only && bash termux-oneclick.sh start
```

### 报错：`git: command not found`
```bash
pkg install -y git
```

### 报错：`node: command not found` 或 `npm: command not found`
```bash
pkg install -y nodejs-lts
```

### 页面白屏
```bash
cd ~/st-resource-manager && git pull --ff-only && npm run build && bash termux-oneclick.sh restart
```

---

## 7. 数据目录说明
默认数据根目录：

```text
~/.st-resource-manager
```

关键文件：
1. `config/instances.json`
2. `config/security.json`
3. `config/app-settings.json`
4. `state/write-queue.json`
5. `state/scan-cache.json`
6. `state/trash-index.json`
7. `vault/meta.json`
8. `audit/actions.log`

---

## 8. 云端入口（可加参数）
你也可以直接远程执行其他动作：

### 远程状态
```bash
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- status
```

### 远程日志
```bash
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- logs
```

### 远程重启
```bash
curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash -s -- restart
```

---

## 9. 给小白的最短路径
只记这一行就行：

```bash
pkg install -y curl git && curl -fsSL https://raw.githubusercontent.com/qishiwan16-hub/termuxsillytavern/main/bootstrap-termux.sh | bash
```

然后浏览器打开：

```text
http://127.0.0.1:3888
```
