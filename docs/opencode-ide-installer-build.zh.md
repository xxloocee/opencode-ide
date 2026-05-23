/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# OpenCode IDE 安装包构建说明

## 适用范围

这份文档说明的是 `opencode-ide` 如何联合本地 `opencode-private` 构建可分发产物，以及当前推荐的构建方式。

它解决的是四个问题：

1. `opencode-ide` 和 `opencode-private` 在构建链路上的职责怎么划分。
2. Windows 本机怎么快速验证打包链路。
3. 哪些产物是“可直接运行目录”，哪些才是“安装器”。
4. 为什么当前不把 GitHub Actions 作为主构建链路。

## 先把命名问题说清楚

产品和仓库已经改名，但构建链路里还有历史标识没有完全清掉。

当前可以把名字分成两层：

1. 当前项目名
   - 仓库：`opencode-ide`
   - 宿主产品：OpenCode IDE
   - 助手内核仓库：`opencode-private`
2. 当前真实存在的技术标识
   - 环境变量：`ERGOUZICODE_OPENCODE_SOURCE_DIR`
   - 环境变量：`ERGOUZICODE_OPENCODE_SKIP_BASELINE`
   - 应用名与产物：`ErgouziCode.exe`、`ErgouziCode Preview`
   - 安装器中间文件：`VSCodeSetup.exe`

文档里的原则是：

- 讲协作关系和仓库边界时，用新名字
- 讲实际命令、环境变量和当前产物时，用代码里真实存在的旧标识

不然就会出现“文档写得很新，命令一跑全报错”的低山臭水遇知音现场。

## 一句话原则

日常开发先走“本机单平台快验证”，正式发布再走“多平台完整出包”。

## 当前结论

截至当前状态：

1. Windows x64 本机联合打包链路已经验证通过。
2. `opencode-ide` 能把 `opencode-private` 构建出来的 runtime 打进最终分发目录。
3. Windows x64 的系统安装版和用户安装版都已经可以本机生成。
4. macOS 和 Linux 暂时不走 GitHub Actions，而是在对应设备上手动构建。

## 目录和职责

### OpenCode IDE

仓库路径：

- `D:\Project\Wan\opencode-ide`

职责：

- 负责 IDE 主程序构建。
- 负责把 OpenCode runtime 打进安装包。
- 负责 Windows 安装器打包。

### OpenCode

仓库路径：

- `D:\Project\Wan\opencode-private`

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
- `opencode-ide` 依赖已安装
- `opencode-private` 依赖已安装

本机验证时默认使用：

- 本地 `opencode-private`
- 本地 `opencode-ide`

不依赖 GitHub Actions。

## 关键环境变量

### `ERGOUZICODE_OPENCODE_SOURCE_DIR`

作用：

- 告诉 `opencode-ide` 去哪里找 OpenCode 源码并构建 runtime。

默认相邻目录已经切到 `opencode-private`；如果你的本地目录不同，可以用这个变量显式指定。

本机示例：

```powershell
$env:ERGOUZICODE_OPENCODE_SOURCE_DIR='D:\Project\Wan\opencode-private'
```

### `ERGOUZICODE_OPENCODE_SKIP_BASELINE`

作用：

- 仅用于本机快速验证时跳过 `x64 baseline` runtime。

原因：

- baseline 主要是为了兼容不支持 AVX2 的老 CPU。
- 本机验证阶段，它不是第一优先级。
- 有时 Bun 在本机拉取 baseline 运行时会失败，影响验证速度。

本机示例：

```powershell
$env:ERGOUZICODE_OPENCODE_SKIP_BASELINE='1'
```

注意：

- 这是“本机快验证开关”，不是正式发布默认策略。

## Windows 本机推荐流程

### 第一步：先构建 OpenCode runtime

命令：

```powershell
bun run --cwd D:\Project\Wan\opencode-private\packages\opencode build --single
```

作用：

- 先验证 `opencode-private` 自己是否能在本机正常产出 Windows x64 runtime。

成功后可看到类似产物：

- `D:\Project\Wan\opencode-private\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe`

### 第二步：构建 OpenCode IDE Windows x64 最小分发目录

命令：

```powershell
$env:ERGOUZICODE_OPENCODE_SOURCE_DIR='D:\Project\Wan\opencode-private'
$env:ERGOUZICODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-min"
```

作用：

- 构建 IDE 主程序。
- 构建并打入 OpenCode runtime。
- 生成一个“可直接运行”的 Windows 分发目录。

注意：

- 本机验证不要优先跑 `vscode-win32-x64-min-ci`。
- `-ci` 更像“已有前置产物后再包装”的任务。
- 本机冷启动验证应该优先跑 `vscode-win32-x64-min`。

成功后主产物目录在：

- `D:\Project\Wan\VSCode-win32-x64`

其中关键文件包括：

- 当前主程序文件名是：`D:\Project\Wan\VSCode-win32-x64\ErgouziCode.exe`
- OpenCode runtime：`D:\Project\Wan\VSCode-win32-x64\resources\app\opencode\bin\opencode.exe`

这里要特别注意：

- 产品协作关系已经是 OpenCode IDE + OpenCode
- 当前 `product.json` 里的应用名是 `ErgouziCode Preview`
- 运行文件名已经完成产品级重命名

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
$env:ERGOUZICODE_OPENCODE_SOURCE_DIR='D:\Project\Wan\opencode-private'
$env:ERGOUZICODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-system-setup"
```

用户安装版：

```powershell
$env:ERGOUZICODE_OPENCODE_SOURCE_DIR='D:\Project\Wan\opencode-private'
$env:ERGOUZICODE_OPENCODE_SKIP_BASELINE='1'
npm run gulp "vscode-win32-x64-user-setup"
```

生成位置：

- 系统安装版：
  `D:\Project\Wan\opencode-ide\.build\win32-x64\system-setup\VSCodeSetup.exe`
- 用户安装版：
  `D:\Project\Wan\opencode-ide\.build\win32-x64\user-setup\VSCodeSetup.exe`

注意：

- 当前工作流会把这些中间产物再重命名为 `ErgouziCodeSetup-*` 之类的发布文件名
- 但构建目录里的原始文件名仍然是 `VSCodeSetup.exe`

## 产物区别

### 可直接运行目录

目录：

- `D:\Project\Wan\VSCode-win32-x64`

特点：

- 这是安装前的 staging 目录。
- 可以直接运行当前实际产物 `ErgouziCode.exe`。
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

如果打开 OpenCode IDE 后怀疑 OpenCode 没接上，可以检查：

1. `resources/app/opencode/bin/opencode.exe` 是否存在。
2. 本地是否监听了 `127.0.0.1` 端口。
3. IDE 宿主是否和对应端口建立了本地 TCP 连接。

多窗口场景下：

- 每个窗口可能会拉起自己的 OpenCode runtime。
- 看到多个 `ErgouziCode.exe` 和多个 `opencode.exe` 进程是正常的。
- 这符合 Electron / VS Code 多进程模型。

## macOS 和 Linux 当前建议

当前不把 `opencode-ide` 的 GitHub Actions 当成主构建链路。

原因：

- 全平台矩阵耗时太长。
- 日常开发验证反馈过慢。
- 当前更适合“各平台在对应设备上手动构建”。

推荐方式：

1. 把 `opencode-ide` 拉到对应平台设备。
2. 把 `opencode-private` 拉到对应平台设备。
3. 先本机构建 `opencode-private` runtime。
4. 再在对应平台本机构建 `opencode-ide`。

也就是说：

- Windows 在 Windows 设备上手动构建
- macOS 在 macOS 设备上手动构建
- Linux 在 Linux 设备上手动构建

## 为什么暂时不走 GitHub Actions 自动打包

当前不推荐把它作为主开发链路，原因有三个：

1. 多平台矩阵太慢。
2. `opencode-ide` 自己的主构建比 `opencode-private` 慢很多。
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

### 安装器和应用名

当前构建链路里仍然有少量 VS Code / Inno Setup 历史中间名：

- `product.json` 里是 `ErgouziCode Preview`
- 可执行文件当前是 `ErgouziCode.exe`
- Inno Setup 中间产物仍是 `VSCodeSetup.exe`

这不影响功能，但意味着“项目协作改名”还没有完全落到最终构建产物。

如果后续要彻底完成对外命名切换，建议单独处理：

1. `product.json`
2. Windows 安装器命名
3. 工作流产物命名
4. 文档与下载页文案

## 推荐使用顺序

后续自己构建时，推荐按这个顺序：

1. 先构建 `opencode-private` runtime。
2. 再跑 `opencode-ide` 的 `vscode-win32-x64-min`。
3. 验证 `VSCode-win32-x64\resources\app\opencode\bin\opencode.exe` 是否存在。
4. 需要安装器时，再补 `vscode-win32-x64-inno-updater`。
5. 最后跑 `system-setup` 或 `user-setup`。

## 后续可优化项

如果以后还要继续优化构建效率，优先方向是：

1. 缓存 IDE 主 bundle。
2. 缓存 Copilot 扩展编译。
3. 把 OpenCode runtime 从“每次现编”演进到“可复用产物”。
4. 再决定是否恢复 GitHub Actions 多平台自动出包。
