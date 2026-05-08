/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# QuantCode 安装包构建说明

## 适用范围

这份文档说明的是 QuantCode 如何联合本地 `opencode-source` 构建可分发产物，以及当前推荐的构建方式。

它解决的是四个问题：

1. `QuantCode` 和 `opencode-source` 在构建链路上的职责怎么划分。
2. Windows 本机怎么快速验证打包链路。
3. 哪些产物是“可直接运行目录”，哪些才是“安装器”。
4. 为什么当前不把 GitHub Actions 作为主构建链路。

## 一句话原则

日常开发先走“本机单平台快验证”，正式发布再走“多平台完整出包”。

## 当前结论

截至当前状态：

1. Windows x64 本机联合打包链路已经验证通过。
2. QuantCode 能把 `opencode-source` 构建出来的 runtime 打进最终分发目录。
3. Windows x64 的系统安装版和用户安装版都已经可以本机生成。
4. macOS 和 Linux 暂时不走 GitHub Actions，而是在对应设备上手动构建。

## 目录和职责

### QuantCode

仓库路径：

- `D:\Project\github\QuantCode`

职责：

- 负责 IDE 主程序构建。
- 负责把 OpenCode runtime 打进安装包。
- 负责 Windows 安装器打包。

### OpenCode

仓库路径：

- `D:\Project\github\opencode-source`

职责：

- 负责 OpenCode runtime 二进制构建。
- 负责内嵌前端资源和 server/runtime 产物。

## 平台和架构说明

当前代码实际支持的是：

- Windows: `x64`、`arm64`
- macOS: `x64`、`arm64`
- Linux: `x64`、`arm64`

这里的 `x86` 指的应理解为 `x64`，不是 32 位 `ia32`。

## 环境前提

### Windows 本机

需要满足：

- 操作系统为 `win32 x64`
- `bun` 可用
- `npm` 可用
- `QuantCode` 依赖已安装
- `opencode-source` 依赖已安装

本机验证时默认使用：

- 本地 `opencode-source`
- 本地 `QuantCode`

不依赖 GitHub Actions。

## 关键环境变量

### `QUANTCODE_OPENCODE_SOURCE_DIR`

作用：

- 告诉 QuantCode 去哪里找 OpenCode 源码并构建 runtime。

本机示例：

```powershell
$env:QUANTCODE_OPENCODE_SOURCE_DIR='D:\Project\github\opencode-source'
```

### `QUANTCODE_OPENCODE_SKIP_BASELINE`

作用：

- 仅用于本机快速验证时跳过 `x64 baseline` runtime。

原因：

- baseline 主要是为了兼容不支持 AVX2 的老 CPU。
- 本机验证阶段，它不是第一优先级。
- 有时 Bun 在本机拉取 baseline 运行时会失败，影响验证速度。

本机示例：

```powershell
$env:QUANTCODE_OPENCODE_SKIP_BASELINE='1'
```

注意：

- 这是“本机快验证开关”，不是正式发布默认策略。

## Windows 本机推荐流程

### 第一步：先构建 OpenCode runtime

命令：

```powershell
bun run --cwd D:\Project\github\opencode-source\packages\opencode build --single
```

作用：

- 先验证 `opencode-source` 自己是否能在本机正常产出 Windows x64 runtime。

成功后可看到类似产物：

- `D:\Project\github\opencode-source\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe`

### 第二步：构建 QuantCode Windows x64 最小分发目录

命令：

```powershell
$env:QUANTCODE_OPENCODE_SOURCE_DIR='D:\Project\github\opencode-source'
$env:QUANTCODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-min"
```

作用：

- 构建 QuantCode 主程序。
- 构建并打入 OpenCode runtime。
- 生成一个“可直接运行”的 Windows 分发目录。

注意：

- 本机验证不要优先跑 `vscode-win32-x64-min-ci`。
- `-ci` 更像“已有前置产物后再包装”的任务。
- 本机冷启动验证应该优先跑 `vscode-win32-x64-min`。

成功后主产物目录在：

- `D:\Project\github\VSCode-win32-x64`

其中关键文件包括：

- 主程序：`D:\Project\github\VSCode-win32-x64\QuantCode.exe`
- OpenCode runtime：`D:\Project\github\VSCode-win32-x64\resources\app\opencode\bin\opencode.exe`

### 第三步：补齐 Windows 安装器前置工具

命令：

```powershell
npm run gulp "vscode-win32-x64-inno-updater"
```

作用：

- 给 Windows 安装器准备 `tools\inno_updater.exe`

注意：

- 如果直接跑 setup 而不先跑这一步，Inno Setup 会因为缺少 `tools\*` 失败。

### 第四步：生成 Windows 安装器

系统安装版：

```powershell
$env:QUANTCODE_OPENCODE_SOURCE_DIR='D:\Project\github\opencode-source'
$env:QUANTCODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-system-setup"
```

用户安装版：

```powershell
$env:QUANTCODE_OPENCODE_SOURCE_DIR='D:\Project\github\opencode-source'
$env:QUANTCODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-user-setup"
```

生成位置：

- 系统安装版：
  `D:\Project\github\QuantCode\.build\win32-x64\system-setup\VSCodeSetup.exe`
- 用户安装版：
  `D:\Project\github\QuantCode\.build\win32-x64\user-setup\VSCodeSetup.exe`

## 产物区别

### 可直接运行目录

目录：

- `D:\Project\github\VSCode-win32-x64`

特点：

- 这是安装前的 staging 目录。
- 可以直接运行 `QuantCode.exe`。
- 适合本机快速验证。
- 不等于安装器安装后的最终目录。

### 安装器

位置：

- `.build\win32-x64\system-setup\VSCodeSetup.exe`
- `.build\win32-x64\user-setup\VSCodeSetup.exe`

特点：

- 这是用户真正双击安装的包。
- 会把文件落到目标安装目录。
- 安装后的目录会比 staging 目录多出卸载器等安装器附加文件。

## 系统安装版和用户安装版的区别

### 系统安装版

- 面向整台机器安装
- 一般需要管理员权限
- 通常安装到机器级目录
- 更适合长期主力安装

### 用户安装版

- 只安装到当前用户
- 通常不需要管理员权限
- 更适合个人试用和低风险升级

### 是否必须先卸载

同一种安装类型：

- 一般不需要先手工卸载
- 安装器本身支持覆盖/升级同类安装

切换安装类型：

- 建议先卸载再装
- 例如从“用户版”切到“系统版”
- 脚本会提示冲突，但不会自动帮你迁移

## 运行时检查要点

如果打开 QuantCode 后怀疑 OpenCode 没接上，可以检查：

1. `resources/app/opencode/bin/opencode.exe` 是否存在。
2. 本地是否监听了 `127.0.0.1` 端口。
3. QuantCode 是否和对应端口建立了本地 TCP 连接。

多窗口场景下：

- 每个窗口可能会拉起自己的 OpenCode runtime。
- 看到多个 `QuantCode.exe` 和多个 `opencode.exe` 进程是正常的。
- 这符合 Electron / VS Code 多进程模型。

## macOS 和 Linux 当前建议

当前不把 QuantCode 的 GitHub Actions 当成主构建链路。

原因：

- 全平台矩阵耗时太长。
- 日常开发验证反馈过慢。
- 当前更适合“各平台在对应设备上手动构建”。

推荐方式：

1. 把 `QuantCode` 拉到对应平台设备。
2. 把 `opencode-source` 拉到对应平台设备。
3. 先本机构建 `opencode-source` runtime。
4. 再在对应平台本机构建 QuantCode。

也就是说：

- Windows 在 Windows 设备上手动构建
- macOS 在 macOS 设备上手动构建
- Linux 在 Linux 设备上手动构建

## 为什么暂时不走 GitHub Actions 自动打包

当前不推荐把它作为主开发链路，原因有三个：

1. 多平台矩阵太慢。
2. `QuantCode` 自己的主构建比 `opencode-source` 慢很多。
3. 开发阶段更需要 5 到 20 分钟内得到反馈，而不是几小时后才知道是否打坏。

所以当前更合理的分层是：

- 开发验证：本机单平台快验证
- 正式发布：再考虑多平台完整出包

## 当前已知取舍

### baseline runtime

本机快验证时允许先跳过 baseline。

影响：

- 产物里可能只有 `opencode.exe`
- 没有 `opencode-baseline.exe`

这不影响当前开发验证，但不代表正式发布一定可以省略。

### 安装器名称

当前 Inno Setup 生成的文件名仍然是：

- `VSCodeSetup.exe`

这不影响内容，它实际打的是 QuantCode 包。

如果后续需要对外分发，建议再补一层更清晰的产物命名，例如：

- `QuantCodeSetup-x64.exe`
- `QuantCodeUserSetup-x64.exe`

## 推荐使用顺序

后续自己构建时，推荐按这个顺序：

1. 先构建 `opencode-source` runtime。
2. 再跑 QuantCode 的 `vscode-win32-x64-min`。
3. 验证 `VSCode-win32-x64\resources\app\opencode\bin\opencode.exe` 是否存在。
4. 需要安装器时，再补 `vscode-win32-x64-inno-updater`。
5. 最后跑 `system-setup` 或 `user-setup`。

## 后续可优化项

如果以后还要继续优化构建效率，优先方向是：

1. 缓存 QuantCode 主 bundle。
2. 缓存 Copilot 扩展编译。
3. 把 OpenCode runtime 从“每次现编”演进到“可复用产物”。
4. 再决定是否恢复 GitHub Actions 多平台自动出包。
