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

## 本地手动构建

手动构建前先完成净化和校验：

```powershell
node tools\sanitize\sanitize.test.mjs
node tools\sanitize\apply.mjs --profile=clean-full
node tools\sanitize\verify.mjs --profile=clean-full
```

### Windows x64 system setup 推荐入口

Windows 本地 release 构建优先使用仓库脚本，让 Node、MSVC、`signtool.exe` 和 gulp 前置任务保持一致：

```powershell
nvm use 24.15.0
npm run opencode-clean:win32-system-setup
```

脚本入口：

```text
scripts/opencode-clean-win32-system-setup.ps1
```

脚本会按顺序执行：

1. 检查当前 Node.js 是否匹配 `.nvmrc`。
2. 设置本地 Windows 原生依赖构建环境：
   - `GYP_MSVS_VERSION=2022`
   - `npm_config_msvs_version=2022`
   - `VCToolsVersion=14.42.34433`
   - `PreferredToolArchitecture=x64`
3. 在 Windows SDK 目录中查找 `signtool.exe` 并加入当前进程的 `PATH`。
4. 执行 `sanitize.test.mjs`、`apply.mjs --profile=clean-full`、`verify.mjs --profile=clean-full`。
5. 执行 `npm ci`。
6. 执行 `vscode-win32-x64-min`。
7. 执行 `vscode-win32-x64-system-setup`。

本机已验证可用的工具链组合：

```powershell
$env:GYP_MSVS_VERSION='2022'
$env:npm_config_msvs_version='2022'
$env:VCToolsVersion='14.42.34433'
$env:PreferredToolArchitecture='x64'
$env:PATH='C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64;' + $env:PATH
```

如果本机已完成净化或依赖安装，可以显式跳过对应步骤：

```powershell
npm run opencode-clean:win32-system-setup -- -SkipSanitize
npm run opencode-clean:win32-system-setup -- -SkipNpmCi
npm run opencode-clean:win32-system-setup -- -ValidateOnly
```

如果 OpenCode baseline runtime 下载或解压失败，例如出现 `Failed to extract executable for 'bun-windows-x64-baseline-*'`，本地临时验证可以显式跳过 baseline：

```powershell
npm run opencode-clean:win32-system-setup -- -SkipBaseline
```

`-SkipBaseline` 只用于本地兜底，不应默认用于正式 release parity 校验。正式 tag workflow 仍应尽量保留 baseline runtime 构建，除非明确接受 runtime 产物差异。

命令含义：

- `npm ci`：按 `package-lock.json` 精确安装仓库依赖，适合 CI 和干净本地构建；它会重建 `node_modules`，确保后续 gulp 构建使用锁定版本。
- `npm run gulp vscode-win32-x64-min`：生成最小化客户端目录，setup 任务依赖这个前置输出。
- `npm run gulp vscode-win32-x64-system-setup`：通过仓库里的 gulp 构建入口执行 `vscode-win32-x64-system-setup` 任务，生成 Windows x64 的系统级安装器。

### 手动命令等价流程

如果需要绕过脚本逐步排查，可以手动执行：

```powershell
nvm use 24.15.0
$env:GYP_MSVS_VERSION='2022'
$env:npm_config_msvs_version='2022'
$env:VCToolsVersion='14.42.34433'
$env:PreferredToolArchitecture='x64'
$env:PATH='C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64;' + $env:PATH

node tools\sanitize\sanitize.test.mjs
node tools\sanitize\apply.mjs --profile=clean-full
node tools\sanitize\verify.mjs --profile=clean-full
npm ci
npm run gulp vscode-win32-x64-min
npm run gulp vscode-win32-x64-system-setup
```

常用 Windows x64 本地产物任务：

```powershell
npm run gulp vscode-win32-x64-min
npm run gulp vscode-win32-x64-inno-updater
npm run gulp vscode-win32-x64-system-setup
npm run gulp vscode-win32-x64-user-setup
```

其中 `vscode-win32-x64-min` 生成最小化客户端目录，后续 setup 任务会基于构建输出生成安装器。只跑 `system-setup` 时，如果缺少前置构建输出，可能需要先跑 `vscode-win32-x64-min`。

## 净化边界

`clean-full` 当前覆盖：

- 产品命名、协议名、安装包名、桌面入口。
- 默认登录、认证、同步入口。
- Accounts 全局入口默认隐藏，避免干净 profile 首屏出现登录暗示。
- Agents/Sessions 里的官方账号登录和 Copilot Chat sessions provider。
- 常用设置、编辑遥测等 UI 边角里的 Copilot 默认引用。
- 欢迎页和入门页里的 Sign in、Copilot、VS Code 官方文档链接等残留。
- 首次启动默认不自动打开欢迎页。
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

### tag workflow 审阅结论

`.github/workflows/build-quantcode-installers.yml` 当前适合继续作为 `opencode-clean-v*.*.*` tag 的发布入口，但打 tag 前要注意下面几条边界：

- Windows job 使用 `windows-2022`，通常会落到 VS2022 Build Tools，能避开本机 VS2026 缺 Spectre libs 导致 `npm ci` 失败的问题。
- Windows job 已经在 Windows SDK 下自动查找 `signtool.exe` 并加入 `PATH`，与本地脚本保持一致。
- tag 触发时 `OPENCODE_REPOSITORY` 固定为 `xxloocee/opencode-private`，`OPENCODE_REF` 固定为 `main`。这意味着同一个 IDE tag 在不同时间重跑，可能拿到不同的 OpenCode runtime commit；workflow 会在 `BUILD_INFO-*.txt` 记录实际 `opencode_sha`，但发布语义上仍要接受“runtime 跟随 main”的策略。
- workflow 默认不设置 `ERGOUZICODE_OPENCODE_SKIP_BASELINE=1`。这是正确的 release parity 默认值；如果 CI 也遇到 Bun baseline 下载或解压失败，应优先修 baseline 获取逻辑，而不是直接把 skip baseline 变成 tag 构建默认值。
- `vscode-win32-<arch>-system-setup` 依赖前置的 `vscode-win32-<arch>-min` 输出，workflow 已按 `min`、`inno-updater`、`system-setup`、`user-setup` 顺序执行。
- `build/win32/code.iss` 里的顶层 `tools\*` 应保持可选；clean-full 输出不一定包含顶层 `tools` 目录，否则本地和 CI 的 setup 任务都会在 Inno Setup 阶段失败。
- `release` job 只在 tag 以 `refs/tags/opencode-clean-v` 开头时执行，且依赖所有 matrix build 完成。任何一个平台失败都会阻止 GitHub Release 创建，这是发布流程的合理失败模式。

如果后续希望 tag 构建完全可复现，建议把 `OPENCODE_REF` 从固定 `main` 改为随 IDE tag 明确记录的 runtime tag 或 commit SHA。

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

每个平台的 workflow artifact 还会附带：

- `BUILD_INFO-<platform>-<arch>.txt`
- `SHA256SUMS.txt`，由 release job 统一生成。

GitHub Release 页面只上传最终安装包：

- Windows：`OpenCodeIDESetup-*.exe`、`OpenCodeIDEUserSetup-*.exe`
- macOS：`OpenCodeIDE-darwin-*.dmg`
- Linux：`.deb`、`.rpm`

`zip`、`tar.gz` 和 `BUILD_INFO-*.txt` 只保留在 workflow artifact 或 release notes 中，不作为 release asset 上传。

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

如果本地 `npm ci` 失败：

- 先确认 Node.js 与 `.nvmrc` 一致，当前要求是 `24.15.0`。
- 如果 Windows 原生模块构建报 MSBuild 或 Spectre libs 相关错误，优先使用 VS2022 Build Tools，并设置 `GYP_MSVS_VERSION=2022`、`npm_config_msvs_version=2022`、`VCToolsVersion=14.42.34433`。
- 不要优先改 `package-lock.json` 或降级依赖；这类错误通常是本机 C++ 构建工具链选择不对。

如果 Windows setup 阶段找不到 `signtool.exe`：

- 确认安装了 Windows SDK。
- 把类似 `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64` 的目录加入当前构建进程 `PATH`。
- 推荐直接使用 `npm run opencode-clean:win32-system-setup`，脚本会自动搜索 Windows SDK 下的 `signtool.exe`。

如果 OpenCode baseline runtime 下载或解压失败：

- 本地临时验证可以使用 `npm run opencode-clean:win32-system-setup -- -SkipBaseline`。
- 正式 tag workflow 不应默认跳过 baseline；CI 也失败时，优先检查 Bun baseline 下载 URL、缓存和解压逻辑。

如果某个平台构建失败：

- 先区分是 runner、依赖安装、净化脚本还是平台打包任务失败。
- Windows 已经跑通过时，macOS/Linux 失败通常优先看平台专属 gulp 任务和系统依赖。
- arm64 失败时，优先看 runner 标签、原生依赖和平台二进制下载逻辑。
