# 分支同步与开发流程

本文档说明这个仓库的分支职责、上游同步方式，以及日常开发时应该怎么操作。

## 目标

这个仓库同时要满足两件事：

1. 持续跟进上游 `microsoft/vscode` 的最新 `main` 分支。
2. 保留我们自己的改动，并且让这些改动尽量集中在稳定的开发线上。

核心取舍是把“同步上游”和“做自己的开发”拆开。这样做的好处是：

- 上游同步逻辑简单，`sync-main` 可以持续自动 rebase。
- 自己的开发历史集中在 `dev`，不会和自动同步分支混在一起。
- 后续遇到冲突时，问题边界清楚，知道是在“同步层”还是“开发层”。

## 分支职责

### `sync-main`

- 这是上游同步分支。
- 它的目标是尽量等于上游 `upstream/main`。
- GitHub Action 会定时把它 rebase 到最新上游提交。
- 这个分支允许被 force-push 改写历史。
- 不在这个分支上保留私有功能提交、产品定制提交或稳定集成提交。
- 不要在这个分支上做日常功能开发。

### `main`

- 这是稳定集成分支。
- 它承接已经整理好的私有改动和保留历史的合并结果。
- 这个分支适合作为 GitHub 默认分支、仓库主页展示分支，以及对外查看主线历史的入口。
- 不让自动同步 workflow 直接改写这个分支的历史。

### `dev`

- 这是日常开发分支。
- 所有功能开发、修复、实验性修改都应从这里开始。
- 如果需要短期开发，可以从 `dev` 再切 `feature/*` 分支。
- 在准备合并或同步时，把 `dev` rebase 到最新 `main` 或 `sync-main`。

## 远端约定

- `origin`：当前私有仓库。
- `upstream`：官方上游仓库 `https://github.com/microsoft/vscode.git`。

## 自动同步机制

仓库中的 workflow 文件：

- `.github/workflows/rebase-main-with-vscode.yml`

这个 workflow 的职责是：

1. 定时获取上游 `upstream/main`。
2. 检查当前 `sync-main` 是否落后于上游。
3. 如果落后，则把 `sync-main` rebase 到最新上游。
4. 成功后 force-push 回私库的 `sync-main`。

注意：由于 GitHub 的定时 workflow 只能从默认分支读取定义，这个 workflow 文件会保留在默认分支 `main` 上，但它实际操作的目标分支是 `sync-main`。

这样 `sync-main` 始终扮演“纯上游同步线”的角色，而不是“日常开发线”或“稳定集成线”。

## 日常开发流程

### 开始开发

```bash
git checkout dev
git fetch origin
git pull --ff-only origin dev
```

如果要做独立功能：

```bash
git checkout -b feature/xxx dev
```

### 同步最新上游基线

先更新本地 `sync-main`：

```bash
git checkout sync-main
git fetch origin
git reset --hard origin/sync-main
```

注意，这里不要对 `sync-main` 使用普通 `git pull`。因为 `sync-main` 会被自动 rebase 并 force-push，历史可能被改写。

如果本地还没有 `sync-main`，或者需要重新从上游建立纯净基线，可以直接从 `upstream/main` 创建：

```bash
git fetch upstream
git checkout -B sync-main upstream/main
```

如果你要查看或使用稳定主线，再切回 `main`：

```bash
git checkout main
git fetch origin
git pull --ff-only origin main
```

### 让开发分支跟上最新基线

```bash
git checkout dev
git rebase sync-main
```

如果你在 `feature/*` 上开发，则把对应功能分支 rebase 到 `sync-main` 或 `dev`。

## 提交流程建议

推荐顺序：

1. 日常改动提交到 `dev` 或 `feature/*`。
2. 在准备整合前，先同步本地 `sync-main`。
3. 如果要先吃到最新上游，把 `dev` 或 `feature/*` rebase 到最新 `sync-main`；如果只是整理稳定集成结果，则 rebase 到最新 `main`。
4. 确认稳定后，把 `dev` merge 到 `main`，保留合并痕迹。
5. 再继续测试、整理和发布。

## GitHub 仓库设置建议

- 默认分支建议设为 `main`。
- 自动同步目标分支使用 `sync-main`。
- 日常开发实际使用 `dev`。
- 仓库需要配置 `UPSTREAM_SYNC_TOKEN` 供同步 workflow 使用。

`UPSTREAM_SYNC_TOKEN` 推荐权限：

- `Contents: Read and write`
- `Workflows: Read and write`

## 为什么不用 `main` 直接同步上游

如果把自动同步和稳定集成都放在 `main` 上，会有两个问题：

1. 上游同步和自己的稳定集成历史会混在一起，历史语义不清楚。
2. 每次自动 rebase 都会直接改写对外可见的主分支，排障和回溯成本更高。

所以这里的关键边界是：

- `sync-main` 负责“对齐上游”
- `main` 负责“承接稳定集成结果”
- `dev` 负责“承接自己的改动”

这个边界越稳定，后续维护越省心。

反过来说，如果把私有提交长期放进 `sync-main`，就会重新把“同步层”和“集成层”混在一起，后续每次上游 rebase 时都会放大冲突和排障成本。这正是三层分工要避免的事情。
