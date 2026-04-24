/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# OpenCode 边界约束

## 适用范围

这份文档约束的是 QuantCode 中 OpenCode 右侧助手的代码组织方式。

它解决的是两个问题：

1. OpenCode 在主 IDE 里应该挂在哪一层
2. 后续继续接功能时，哪些改法是允许的，哪些改法应该避免

## 一句话原则

主 IDE 右侧 OpenCode 助手是 `workbench` feature，不是 `sessions` feature。

## 目录归属

### 应该放在这里

- `src/vs/workbench/contrib/opencode/browser`
- `src/vs/workbench/contrib/opencode/electron-browser`
- `src/vs/platform/opencode/common`
- `src/vs/platform/opencode/node`

### 不应该再放在这里

- `src/vs/sessions/contrib/opencode`

原因不是 OpenCode 没有 session 语义，而是它当前服务的是主 IDE 右侧辅助栏，而不是独立 sessions 应用。

## 层级职责

### common

只放：

- service interface
- state type
- channel name
- setting id

不放：

- UI
- desktop 专属实现
- shared process 具体逻辑

### browser

只放：

- view 注册
- webview resolver
- browser fallback service
- IDE bridge 的 browser 侧处理

不放：

- `ISharedProcessService`
- shared process channel 细节
- Node / child process 逻辑

### electron-browser

只放 desktop 宿主实现：

- 读取配置
- 调用 `ISharedProcessService`
- 连接 OpenCode shared-process channel
- 管理 `IOpenCodeHostService` 的 desktop 版本

### node

只放 sidecar runtime：

- 启动本地 `opencode serve`
- 健康检查
- 清理进程树
- shared process 后端服务实现

## 入口约束

### 允许修改

- `src/vs/workbench/workbench.desktop.main.ts`
  - 引入 `workbench/contrib/opencode/browser`
  - 引入 `workbench/contrib/opencode/electron-browser`

- `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`
  - 注册 OpenCode shared-process channel

### 不建议修改

- `src/vs/code/electron-browser/workbench/workbench.ts`

原因：

- 这是主 IDE 顶层加载入口
- 改这里会影响整个 workbench 的加载顺序
- 容易把独立 app 入口一起拉进来
- 风险远大于 OpenCode 这个 feature 本身

如果遇到“service 注册时机不对”，优先检查：

1. service 是否归属错层
2. 是否应该放进 `workbench.desktop.main.ts`
3. 是否应该放进 `sharedProcessMain.ts`

不要先去改 `workbench.ts`。

## import 规则

### 允许

- `workbench/contrib/opencode/*` 依赖 `workbench/*`
- `workbench/contrib/opencode/*` 依赖 `platform/*`
- `workbench/contrib/opencode/*` 依赖 `base/*`
- `sharedProcessMain.ts` 依赖 `platform/opencode/node/*`

### 不允许

- `workbench/*` 反向依赖 `sessions/*`
- `browser/*` 直接依赖 `electron-browser/*`
- UI contribution 直接拿 shared process channel

如果 UI 需要桌面能力，必须先通过 service 抽象转一层，例如：

- `opencodeWebview.contribution.ts`
  - 只依赖 `IOpenCodeHostService`

- `electron-browser/opencodeHostService.ts`
  - 再去依赖 `ISharedProcessService`

## 代码规范

后续继续改 OpenCode 接入时，遵守下面这些简单规则：

1. 先判断宿主是谁，再决定目录归属
2. 主 IDE 侧边栏功能默认归 `workbench`
3. 不要因为“名字像 session”就放到 `sessions`
4. browser 层只依赖抽象，不依赖桌面 IPC 细节
5. sidecar 生命周期继续集中在 node/shared process 一侧
6. 先复用已有 service 和入口，不额外加启动旁路

## 当前推荐做法

继续演进 OpenCode 时，优先顺序是：

1. 保持 `workbench/contrib/opencode` 的归属不变
2. 在这个目录内扩展 bridge、view、desktop host、node host
3. 只有在未来真的要做独立 sessions app 时，再单独设计 `sessions` 入口

这样可以避免再次出现：

- 主 workbench 反向依赖 `sessions`
- 为了修注册时机去改顶层启动入口
- UI 和 shared process 之间直接耦合
