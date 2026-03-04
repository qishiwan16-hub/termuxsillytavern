# ST Resource Manager (Termux + Vault)

Local-first SillyTavern resource manager WebApp.
It supports instance resource management, file editing, import/export, plugin install, Git sync, and a separate Vault library.

## Features
- Multi-instance support (default `~/SillyTavern`)
- File tree browsing and editing (JSON validation)
- Auto backup and restore
- Queue writes when SillyTavern is running
- ZIP import/export (instance + vault)
- Plugin install (ZIP + Git)
- Git sync for instance/vault (`clone`, `commit`, `pull`, `push`)
- Vault library with favorite/apply/delete
- Auth: setup password, login session, change password, enable/disable auth
- Scan cache + incremental refresh + paged querying

## Quick Start (Termux)
```bash
git clone <your-repo-url> st-resource-manager
cd st-resource-manager
bash scripts/install-termux.sh
bash scripts/start.sh
```

Open:
`http://127.0.0.1:3888`

## Dev
```bash
npm install
npm run dev
npm run build
npm run start
npm run test
```

## Data Paths
- `~/.st-resource-manager/config/instances.json`
- `~/.st-resource-manager/config/security.json`
- `~/.st-resource-manager/state/write-queue.json`
- `~/.st-resource-manager/state/scan-cache.json`
- `~/.st-resource-manager/backups/`
- `~/.st-resource-manager/repos/`
- `~/.st-resource-manager/vault/`
- `~/.st-resource-manager/audit/actions.log`

Override root:
`ST_MANAGER_HOME=/path/to/custom/data`

## Core APIs
- Auth
- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `POST /api/auth/set-enabled`

- Instance
- `GET /api/instances`
- `POST /api/instances`
- `PATCH /api/instances/:id`
- `POST /api/instances/:id/scan` (offset/limit/q/type/includeDirs/refreshMode)
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

- Queue/Backup
- `GET /api/queue`
- `POST /api/queue/:id/cancel`
- `GET /api/backups`
- `POST /api/backups/restore`

- Vault
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
