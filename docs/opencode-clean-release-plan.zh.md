# OpenCode IDE 净化构建发布指南

本文档作为 OpenCode IDE 净化版本的构建和发布指南。目标不是维护一份长期分叉源码，而是在发布分支上保留自动净化脚本，并在打 tag 构建前自动完成净化、校验和打包。

## 发布目标

保留：

- OpenCode 右侧 AI 助手和 IDE 通信桥接。
- app-ide 宿主接入。
- IDE 核心编辑、工作区、终端、调试能力。

移除或默认关闭：

- 微软品牌和官方产品标签。
- 官方登录、认证、同步入口。
- Copilot / 官方 Chat 默认能力。
- 遥测、实验、崩溃上报默认出货配置。
- 依赖微软账号或微软 Marketplace 的默认打包入口。
- 欢迎页、引导页里的官方登录提示、Copilot 文案和外部官方链接。

## 分支策略

净化发布固定在 `release/opencode-clean` 分支进行。

- 不要求合回 `main`。
- `main` 有更新时，先把 `release/opencode-clean` rebase 到最新 `main`，再打测试 tag。
- 净化逻辑应尽量保留在 `tools/sanitize/` 脚本里，避免在净化后的源码上做不可追踪的手工补丁。
- 与 OpenCode 快捷键、IDE 通信桥接等基础能力相关的小范围改动，可以按需提前拣选到 `main`，减少后续 rebase 冲突。

推荐同步流程：

```powershell
git checkout release/opencode-clean
git fetch origin
git rebase origin/main
node tools\sanitize\sanitize.test.mjs
```

如 rebase 出现冲突，优先保留 `main` 的上游结构，再调整 `tools/sanitize/` 的净化规则，让净化结果重新通过校验。

## 净化脚本

当前净化入口：

```text
tools/sanitize/
  apply.mjs
  verify.mjs
  sanitize.test.mjs
```

发布构建使用 `clean-full`：

```powershell
node tools\sanitize\sanitize.test.mjs
node tools\sanitize\apply.mjs --profile=clean-full
node tools\sanitize\verify.mjs --profile=clean-full
```

CI workflow 会在构建前自动执行以上流程。本地通常只需要在修改净化规则或 rebase 后手动跑一遍。

## 净化边界

`clean-full` 当前覆盖：

- 产品命名、协议名、安装包名、桌面入口。
- 默认登录、认证、同步入口。
- Accounts 全局入口默认隐藏，避免干净 profile 首屏出现登录暗示。
- Agents/Sessions 里的官方账号登录和 Copilot Chat sessions provider。
- 常用设置、编辑遥测等 UI 边角里的 Copilot 默认引用。
- 欢迎页和入门页里的 Sign in、Copilot、VS Code 官方文档链接等残留。
- Linux/Windows 安装包模板里的微软品牌文案。

保留边界：

- OpenCode 自己的面板、宿主通信、快捷键和 bridge 必须保留。
- `DefaultAccountService` 不直接出货，使用空实现占位，避免依赖账号服务接口的模块解析失败。
- `extensions/copilot` 源码目录可以暂时保留；当前只保证它不作为默认构建、打包、启动和 UI 能力出现。

## 构建 workflow

发布 workflow：

```text
.github/workflows/build-quantcode-installers.yml
```

触发方式：

- 手动触发：`workflow_dispatch`
- tag 触发：`opencode-clean-v*.*.*`

tag 触发默认构建全部平台和架构：

| 平台 | 架构 | Runner |
| --- | --- | --- |
| macOS | x64 | `macos-15-intel` |
| macOS | arm64 | `macos-14` |
| Windows | x64 | `windows-2022` |
| Windows | arm64 | `windows-11-arm` |
| Linux | x64 | `ubuntu-24.04` |
| Linux | arm64 | `ubuntu-24.04-arm` |

手动触发时可以选择：

- `all`
- `windows`
- `darwin`
- `linux`

其中 `all` 会构建三平台六架构；单平台选项会构建对应平台的 x64 和 arm64。

## 构建产物

Windows：

- `OpenCodeIDE-win32-<arch>-<version>.zip`
- `OpenCodeIDESetup-<arch>-<version>.exe`
- `OpenCodeIDEUserSetup-<arch>-<version>.exe`

macOS：

- `OpenCodeIDE-darwin-<arch>-<version>.zip`
- `OpenCodeIDE-darwin-<arch>-<version>.dmg`

Linux：

- `OpenCodeIDE-linux-<arch>-<version>.tar.gz`
- `.deb`
- `.rpm`

每个平台还会附带：

- `BUILD_INFO-<platform>-<arch>.txt`
- `SHA256SUMS.txt`，由 release job 统一生成。

## 测试 tag 流程

先确认分支干净：

```powershell
git checkout release/opencode-clean
git status --short --branch
```

本地快速校验：

```powershell
node --check tools\sanitize\apply.mjs
node --check tools\sanitize\verify.mjs
node --check tools\sanitize\sanitize.test.mjs
node tools\sanitize\sanitize.test.mjs
git diff --check
```

提交并推送：

```powershell
git add tools\sanitize .github\workflows\build-quantcode-installers.yml docs\opencode-clean-release-plan.zh.md
git commit -m "chore: update opencode clean release guide"
git push origin release/opencode-clean
```

打测试 tag：

```powershell
git tag opencode-clean-v0.0.x-test
git push origin opencode-clean-v0.0.x-test
```

查看 workflow：

```powershell
gh run list --repo xxloocee/opencode-ide --workflow build-quantcode-installers.yml --limit 5
```

## 发布前检查

安装包测试至少覆盖：

- 首次启动欢迎页不出现官方登录提示。
- 欢迎页和引导页不出现 VS Code、Copilot、Microsoft 官方外链等残留。
- `Ctrl+L` 能在欢迎页或面板尚未创建时唤起 OpenCode AI 面板。
- OpenCode 面板和 IDE 宿主通信正常。
- 新建干净 profile 后 Accounts、Sessions、Chat 相关入口不触发官方登录链路。
- Windows 安装器、开始菜单、卸载项、桌面入口命名正确。

三平台构建首次跑通后，再把测试 tag 版本作为后续正式发布流程的基准。

## 常见问题

如果 tag 没有触发构建：

- 确认 tag 名匹配 `opencode-clean-v*.*.*`。
- 确认 tag 已推送到 `origin`。
- 确认 workflow 文件存在于 tag 指向的提交中。

如果净化校验失败：

- 不要直接改净化后的源码。
- 先确认失败文件是不是上游结构变化。
- 修改 `tools/sanitize/apply.mjs` 和 `tools/sanitize/verify.mjs`，再补 `sanitize.test.mjs`。

如果某个平台构建失败：

- 先区分是 runner、依赖安装、净化脚本还是平台打包任务失败。
- Windows 已经跑通过时，macOS/Linux 失败通常优先看平台专属 gulp 任务和系统依赖。
- arm64 失败时，优先看 runner 标签、原生依赖和平台二进制下载逻辑。
