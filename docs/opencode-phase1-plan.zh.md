/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# OpenCode 集成第一阶段计划

## 当前目标

第一阶段不是做完整的 AI-first IDE，而是先把这条主链跑通：

1. `opencode-ide` 右侧有独立的 `OpenCode` 标签
2. `opencode-ide` 能启动和管理本地 `opencode serve`
3. `opencode serve` 能按配置选择前端页面
4. IDE 场景使用 `app-ide`，而不是直接改 `packages/app`

一句话：先把“宿主 + sidecar + IDE 专用前端壳”这条链做稳定。

## 当前架构

现在有四层：

- `D:\Project\Wan\opencode-ide`
  IDE 宿主。负责入口、webview、sidecar 启停、生命周期管理。
- `D:\Project\Wan\opencode-private\packages\opencode`
  OpenCode runtime 和 server。负责 API、事件流、静态页面服务。
- `D:\Project\Wan\opencode-private\packages\app`
  原始 OpenCode 前端。保持不动，继续作为上游通用工作台。
- `D:\Project\Wan\opencode-private\packages\app-ide`
  IDE 专用前端壳。复用 `app` 的组件和功能单元，但接管 IDE 场景下的页面入口、布局和宿主通信。

## `app-ide` 的作用

`app-ide` 不是重写一套新前端，而是一个 IDE 壳：

- 复用 `app` 已有组件、路由内容和业务单元
- 不修改 `packages/app` 源码
- 只在 IDE 需要差异化的地方接管：
  - 首页入口
  - 外层布局
  - 宿主 bridge
  - 当前工作区心智

这层的核心价值是：把 IDE 特有逻辑从 `app` 里隔离出来，避免把上游前端改成只服务 IDE 宿主的分叉产品。

## `opencode-ide` 侧职责

`opencode-ide` 现在负责三件事：

1. 注册右侧 `OpenCode` 视图
2. 启动本地 `opencode serve`，并传入 `OPENCODE_UI_PACKAGE=app-ide`
3. 用 webview 承载页面，并管理 sidecar 生命周期

也就是说：

- `app-ide` 决定页面长什么样
- `opencode-ide` 决定什么时候启动、用哪个 UI 包、何时清理进程

## 当前第一阶段已经验证通过的部分

- `OpenCode` 已经能作为独立标签出现在右侧
- `opencode-ide` 能通过配置切到 `app-ide`
- `app-ide` 已经能被 `opencode serve` 服务出来
- `packages/app` 目前保持不动

## 当前第一阶段还在收口的部分

下一步重点不是继续扩功能，而是把宿主链收稳：

1. sidecar 生命周期
   - IDE 启动后按需启动
   - IDE 退出后可靠清理
   - 区分“IDE 自己启动的进程”和“外部已存在的进程”

2. `app-ide` 页面接管
   - 继续接管 IDE 场景下的布局和页面心智
   - 不再暴露 OpenCode 原始的项目入口逻辑

3. 最小 bridge
   - 只保留当前真正需要的 IDE 通信能力
   - 不先做大而全的 SDK
   - `selection.add` 只负责把 IDE 当前选区交给 `app-ide`，由 `app-ide` 写入 OpenCode 原生 prompt context，不单独做一套选区 UI
   - 打开 OpenCode 面板不要求必须有代码选区；没有选区时只打开面板，不添加 context
   - `context.change` 只广播稳定宿主快照：workspace、当前编辑器、当前选区、主题
   - diagnostics 暂时不进入 `context.change` 链路；后续需要时通过 `diagnostics.get` 按需拉取
   - `context.change` 发送前做快照去重，避免同一份上下文被重复广播

## 第一阶段不做什么

这一阶段明确不做：

- 重写 `packages/app`
- 深改 VS Code 自带 chat / copilot 内部协议
- 一开始就追求完整原生 inline edit / diagnostics / diff 能力
- 把 OpenCode runtime 拆进 IDE 内部

第一阶段的原则是：

- 先质疑边界
- 再精简结构
- 先跑通主链
- 再逐步增强

## 当前实现原则

- `packages/app` 保持稳定，不做 IDE 特判
- `packages/app-ide` 负责 IDE 页面组装
- `packages/opencode` 负责按环境变量选择要服务的 UI 包
- `opencode-ide` 负责宿主与生命周期
- IDE 选区通过 bridge 进入 OpenCode 原生 file prompt context；由于 OpenCode 默认不会在发送后清理普通 file context，`app-ide` 只移除由 `selection.add` 注入的 host selection context，不影响用户手动添加的 file context
- IDE diagnostics 先保持独立查询能力，不参与 context 快照，也不触发 context 广播

## Bridge 回归清单

每次调整 `context`、`selection`、`theme` 或 webview 承载逻辑后，至少回归：

1. 打开/关闭 OpenCode 面板：无选区时只打开或关闭面板，不注入 context
2. 切换文件：`context.change` 只在当前编辑器快照变化时发送
3. 切换选区：非空选区通过 `selection.add` 注入 OpenCode 原生 file prompt context
4. 切换主题：走 `theme.change`，不额外制造 `context.change`
5. 切换 workspace：workspace 快照变化后 `app-ide` 跟随新目录
6. diagnostics 变化：不触发 `context.change`

## 下一步

当前阶段下一步只做一件事：

- 把 `opencode-ide` 的 sidecar 生命周期管理做稳

也就是：

- 谁启动，谁负责停
- 外部已存在的服务只连接，不接管
- Windows 下确保真正清理到 `bun` 进程树
