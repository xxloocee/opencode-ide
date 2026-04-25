/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# OpenCode IDE Agent 路线

## 当前结论

QuantCode 当前做的是主 IDE 里的 OpenCode 助手，而不是独立的 sessions app。

所以这条线的正确组织方式是：

- `QuantCode` 负责主 IDE 宿主能力和侧边栏入口
- `opencode serve` 负责 sidecar runtime
- `app-ide` 负责 IDE 专用前端壳
- `OpenCode` 在 QuantCode 里的接入代码归 `workbench/contrib/opencode`

这次已经明确不再把 OpenCode 右侧助手放在 `src/vs/sessions/`。

## 为什么不是 sessions

`src/vs/sessions/` 在这个仓库里不是“所有 agent 能力都应该放进去”的意思，它表示一套独立的 sessions workbench。

仓库的分层约束可以简单理解为：

- `workbench` 是主 IDE 工作台
- `sessions` 是另一套独立应用层
- `sessions` 可以依赖 `workbench`
- `workbench` 不应该反向依赖 `sessions`

而 OpenCode 当前的形态是：

- 主 IDE 右侧辅助栏里的一个 view
- 跟编辑器、Explorer、终端并列存在
- 由主 workbench 打开和承载

这类功能按规则应该归 `workbench`，不是 `sessions`。

## 当前架构

### QuantCode

负责：

- 注册 OpenCode 侧边栏入口
- 承载 webview
- 把当前 IDE 的 workspace、文件、选区、主题等上下文传给前端
- 通过 shared process 管理本地 OpenCode sidecar

### OpenCode sidecar

负责：

- 启动 `opencode serve`
- 持有 agent runtime 和 session 流程
- 负责模型调用、工具编排、会话状态

### app-ide

负责：

- IDE 场景下的前端页面
- 会话列表、输入框、会话流和宿主 bridge
- 不修改上游 `packages/app` 的前提下做 IDE 定制

## 当前代码归属

OpenCode 在 QuantCode 里的实现现在应当稳定在下面这组目录：

- `src/vs/workbench/contrib/opencode/browser`
- `src/vs/workbench/contrib/opencode/electron-browser`
- `src/vs/platform/opencode/common`
- `src/vs/platform/opencode/node`

它们分别承担：

- `common`
  - 接口、状态、channel 常量
- `browser`
  - view 注册
  - webview bridge
  - browser fallback service
- `electron-browser`
  - desktop 宿主 service
  - 通过 `ISharedProcessService` 连接 shared process
- `node`
  - sidecar 启停
  - 健康检查
  - 进程树清理

shared process 注册入口保留在：

- `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`

主 workbench 接入入口保留在：

- `src/vs/workbench/workbench.desktop.main.ts`

## 当前边界

第一阶段继续保持这几个边界：

1. OpenCode 的右侧助手属于 `workbench`
2. sidecar 运行时仍然通过 shared process 管理
3. `app-ide` 继续复用 OpenCode 已有 agent/session 流程
4. 不把 OpenCode runtime 拆进 QuantCode 主进程
5. 不为了注册 service 去改 `src/vs/code/electron-browser/workbench/workbench.ts`

最后一条很重要。

`workbench.ts` 是主 IDE 顶层启动入口。为了修 service 注册时机去改这里，虽然能强行跑通，但会影响整个 workbench 的加载顺序，属于高入侵方案，应该避免。

## 后续演进方向

后面可以继续做的不是“再找地方塞到 sessions”，而是顺着现在的 workbench 归属继续扩：

- 完善 OpenCode 右侧面板交互
- 扩展 IDE bridge
- 接编辑器上下文、选区、打开文件、patch 应用
- 继续让 `app-ide` 接管会话 UI
- 再考虑更强的 agent manager、browser tool、artifacts

当前选区 bridge 的边界是：

- `Ctrl/Cmd+L` 可以打开 OpenCode 面板
- 如果当前编辑器有非空选区，QuantCode 额外发送 `selection.add`
- `app-ide` 把 `selection.add` 作为 `type: "file"` 写入 OpenCode 原生 prompt context，复用输入框已有 context chip
- `selection.add` 成功消费后，`app-ide` 将焦点放到输入框，方便直接输入问题
- 不为选区另做一套 dock 或重复 UI
- OpenCode 默认不会在发送后清理普通 file context；`app-ide` 只在发送后移除由 `selection.add` 注入的 host selection context，不把 IDE 选区伪装成评论 context

当前 `context` bridge 的边界是：

- `context.get` / `context.change` 只承载稳定宿主快照：workspace、当前编辑器、当前选区、主题
- marker/diagnostics 变化不触发 `context.change`
- diagnostics 如后续需要，走独立的 `diagnostics.get` 拉取接口
- `context.change` 发送前按快照去重，避免切换过程中的重复事件把 app-ide 推到不必要的重渲染

如果未来要做的是独立 agent workspace 或单独 sessions 应用，再单独设计 `sessions` 侧入口，而不是复用当前这个 sidebar feature。
