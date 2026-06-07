# AI 扩展市场设计

## 当前结论

AI 扩展市场是 IDE 里的独立能力入口，用来浏览、安装和管理面向 AI 助手侧的能力。它不是 VS Code 扩展市场，也不是本地技能浏览器。

第一阶段只做最小闭环：

1. 在线浏览技能、插件、MCP
2. 安装到 IDE profile 管理的本地安装库
3. 生成 OpenCode 可读取的覆盖层
4. 支持启用、停用、卸载和同步状态

核心边界是：市场列表来自线上市场；本地只保存安装状态和运行时覆盖层。

## 架构分层

### `src/vs/workbench/contrib/aiExtensions`

Workbench 层负责产品和交互：

- 注册 Extensions 侧边栏里的“AI 扩展”入口
- 组织技能、插件、MCP 三类导航
- 展示搜索、分组、详情、安装状态和操作按钮
- 调用 AI 扩展市场服务获取线上市场列表
- 调用安装管理逻辑处理安装、启停、卸载和同步

这一层不直接处理跨域请求，也不把市场逻辑散进 `chat`、`sessions` 或 VS Code 扩展市场模块。

### `src/vs/platform/aiExtensions`

Platform 层负责 IDE 与线上市场之间的窄服务边界：

- 定义 AI 扩展市场服务接口和 DTO
- 在 Electron/Node 侧请求线上市场 API
- 通过 shared process IPC 暴露给 renderer
- 避免 renderer 直接请求第三方市场时遇到 CORS 限制

这里不是通用 HTTP 代理，只服务 AI 扩展市场需要的固定来源和数据结构。

### OpenCode 适配层

安装后的能力不直接改用户全局 OpenCode 配置，也不写 workspace 文件。IDE 会根据当前 profile 的安装库生成一份专用覆盖层，再让 IDE 管理的 OpenCode sidecar 读取：

- `OPENCODE_CONFIG_DIR=<profile overlay dir>`
- `OPENCODE_CONFIG=<profile generated config file>`

OpenCode 管运行时加载；IDE 管市场、安装状态和覆盖层生成。

## 数据来源

市场列表必须来自线上市场，不读取本地已安装内容来冒充市场数据。

### 技能

技能列表从线上技能市场请求，例如：

- Claude Skills Library（`claudeskills.club`，已确认可用公开列表 API）
- SkillsMP
- skills.pub
- AgentSkills.to
- Skillery
- SkillWiki
- anthropic-agent-skills

`skills.sh` 是调研里的首选技能目录，但当前适合默认浏览的 API 需要鉴权；公开 `search` API 更适合后续做按关键词远程搜索，不应在第一阶段硬接成默认树形市场源。

计数口径：

- 一级分类展示当前已加载、可展示的条目数，避免把聚合平台的百万级索引量误认为本地已加载内容。
- 来源节点在无搜索条件时优先展示远端返回的总数；如果市场没有总数，再使用当前已加载数量。
- 搜索状态下，来源节点展示当前匹配数量，避免搜索结果里出现全站总数造成误导。

### 插件

插件列表从线上插件市场或公开 registry 请求。可按 Codex、Claude Code、OpenCode、社区等来源归类，但展示数据仍然来自远端市场。

### MCP

MCP 列表从线上 MCP 市场或 registry 请求。只有安装、启用、同步时才会落到本地 profile 安装库和 OpenCode 覆盖层。

## 本地数据的用途

本地数据只用于“已安装状态”和“运行时同步”，不能作为市场列表来源。

允许读取本地的场景：

- 判断某个线上条目是否已安装
- 展示当前 profile 下的启用、停用、同步失败等状态
- 卸载或更新 IDE 管理的安装项
- 生成 OpenCode 覆盖层

不允许的场景：

- 扫描本地 `SKILL.md` 后显示成市场技能
- 扫描本地插件目录后显示成市场插件
- 扫描本地 MCP 配置后显示成市场 MCP
- 用内置示例填充市场列表并伪装成真实市场数据

简化说：`list()` 返回线上市场；`installed()` 返回本地安装状态。两个数据源可以在 UI 上合并状态，但不能混成同一个来源。

## 安装与同步

点击安装后的流程：

1. 从线上市场条目确认来源、类型和权限信息
2. 下载或解析扩展内容
3. 写入当前 IDE profile 的 AI 扩展安装库
4. 更新本地 installed registry
5. 标记为待应用，运行时覆盖层留给显式“重新应用”处理

启停和卸载规则：

- 启用/停用：只改本地启用状态，运行时是否生效由覆盖层重新应用决定
- 卸载：删除 IDE 管理的安装记录和来源副本
- 更新：重新拉取线上市场条目，解析最新可安装内容，保留用户的信任和启用状态，并标记为待应用
- 信任来源：对会影响运行时的插件、MCP 或本地命令类能力记录用户信任；未信任前不能启用
- 重新应用：重新生成 OpenCode 覆盖层，并提示助手侧刷新状态

删除覆盖层不等于卸载；下一次同步会按安装库重建。
覆盖层同步必须尽量使用临时目录和备份回滚，避免一次同步失败清掉上一份可用覆盖层。

## Scope 约束

第一阶段只写 IDE user/profile scope。

允许写：

- IDE 用户数据目录
- 当前 profile 的 AI 扩展安装库
- 当前 profile 的 OpenCode 覆盖层

不自动写：

- workspace 下的 `opencode.json`
- workspace 下的 `.opencode/`
- workspace 下的 `.vscode/settings.json`
- workspace 下的 `.mcp.json`
- 用户全局 `~/.agents`
- 用户全局 `~/.claude`
- 用户全局 `~/.config/opencode`

这样可以避免污染业务仓库，也避免把个人助手配置强加给团队。

## UI 设计口径

入口放在 Extensions 侧边栏，名称为“AI 扩展”。

一级分类：

- 技能
- 插件
- MCP

列表项展示：

- 名称
- 类型
- 来源
- 简介
- 安装状态
- 启用状态
- 权限风险
- 更新或同步状态

操作文案：

- 安装
- 卸载
- 启用
- 停用
- 更新
- 查看详情
- 信任来源
- 刷新市场

## 第一阶段不做

- 不把 AI 扩展当 VS Code extension 安装
- 不做本地技能库浏览器
- 不用本地安装项填充市场列表
- 不写 workspace 配置文件
- 不默认执行第三方 hook
- 不接管用户已有全局 OpenCode、Codex 或 Claude 配置

## 验收口径

第一阶段完成时，应满足：

- Extensions 侧边栏能看到“AI 扩展”
- 技能、插件、MCP 能按线上市场数据展示
- 市场数量优先使用远端返回的总数
- 用户可以显式刷新线上市场列表；本地分页不能冒充远端分页
- 本地已安装项只影响安装状态，不影响市场列表来源
- 安装只写 profile 安装库和 IDE 专用覆盖层
- 无法解析出可同步贡献内容的条目不能显示成安装成功
- 更新会重新拉取远端内容并让安装项回到待应用状态
- 需要信任的来源必须先被用户信任，才允许启用
- 停用后覆盖层不再生成对应能力
- 卸载后安装库和覆盖层都能清理
- 覆盖层同步失败时应保留上一份可用覆盖层
- 工作区没有新增或修改配置文件
- 主要实现集中在 `aiExtensions` 和 OpenCode 适配相关模块
- `opencode-private` / app-ide 可以管理市场和已安装项，但仍通过 IDE bridge 写入 profile 安装库

## 参考

- OpenCode 插件文档：`https://opencode.ai/docs/zh-cn/plugins/`
- OpenCode 技能文档：`https://opencode.ai/docs/zh-cn/skills/`
- OpenCode MCP 文档：`https://opencode.ai/docs/zh-cn/mcp-servers/`
- OpenCode 配置文档：`https://opencode.ai/docs/zh-cn/config/`
