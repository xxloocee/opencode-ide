/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# OpenCode IDE 净化发布计划

## 目标

基于当前 `main` 分支，生成一个可重复执行的净化发布版本。

保留：

- `OpenCode` 右侧助手
- `app-ide` 宿主接入
- IDE 核心编辑、工作区、终端、调试能力

移除：

- 微软品牌和官方产品标签
- 官方登录与认证入口
- Copilot / 官方 Chat 默认能力
- 遥测、实验、崩溃上报默认出货配置
- 依赖微软账号或微软 Marketplace 的默认打包入口

## 参考思路

VSCodium 的核心做法不是“手工改一遍源码”，而是把净化拆成三层：

1. 稳定配置改写
2. 入口补丁移除
3. 结果校验

我们这里照这个思路做，但只针对 `main`，不再额外维护“同步上游”的净化职责。

## 实施方式

1. 先做结构化改写
   - `product.json`
   - `package.json`
   - 安装包和桌面入口模板
2. 再应用补丁集
   - 官方 Chat / Copilot 入口
   - 认证和同步相关注册
   - 构建链里的 Copilot 打包任务
3. 最后做验证
   - 关键字段是否回退
   - 构建链是否还引用被禁用模块
   - 产物命名和桌面入口是否已净化

## 目录建议

```text
tools/sanitize/
  apply.mjs
  verify.mjs
  scan.mjs
  lib/
patches/opencode-clean/
config/sanitize/
  clean-lite.json
  clean-full.json
```

## 净化分级

### `clean-lite`

先把出货面净化出来。

- 品牌名
- 产物名
- 遥测默认关闭
- Copilot 默认不出货
- 认证扩展不出货

### `clean-full`

再把官方 Chat / 登录链路尽量清干净。

- workbench 官方 Chat 入口
- Copilot/Chat 相关构建任务
- 登录、认证、同步相关入口
- 依赖微软账号的默认能力
- Accounts 全局入口默认隐藏，避免干净 profile 首屏出现登录暗示
- Agents/Sessions 独立入口里的官方账号登录和 Copilot Chat sessions provider
- 常用设置、编辑遥测等 UI 边角里的 Copilot 默认引用

边界说明：

- `DefaultAccountService` 不直接出货，改为 `NullDefaultAccountService` 占位，保证依赖账号服务接口的模块仍能解析，但不会触发默认登录。
- sessions 自己的本地 chat/agent 壳保留，只移除依赖 GitHub/Microsoft 账号和 Copilot Chat provider 的入口。
- `extensions/copilot` 源码目录可以暂时保留；`clean-full` 当前先保证它不作为默认构建、打包、启动和 UI 能力出现。后续如果要做源码级隔离，再单独收紧这个目录，避免误伤 `OpenCode` bridge。

## 上游兼容

这里不再做“对上游 rebase 再净化”这层职责。

当前前提是：

- 净化只基于 `main`
- `main` 变更后，重新跑同一套净化脚本
- 结果必须可重复生成，不能依赖人工历史修补

## 影响面

- 产品命名、图标、安装包名、协议名
- 登录、认证、同步、Copilot、Chat
- 遥测、实验、崩溃上报
- 构建脚本、CI、安装器模板、扩展打包

## 风险

- 净化越彻底，和 `main` 的冲突越多
- 官方 Chat / Copilot 入口删得过深，可能误伤 `OpenCode` 自己的 bridge 或宿主层
- 所以先保守落地，再逐步收紧

## 验证

- `product.json` 不再包含官方 Chat 默认入口
- 构建脚本不再打包 Copilot 相关内容
- 登录/认证扩展不再作为默认出货能力
- workbench 启动不注册默认账号登录链路，Accounts 入口在干净 profile 下默认不显示
- Agents/Sessions 入口不注册默认账号服务、官方认证贡献或 Copilot Chat sessions provider
- 常用设置和编辑遥测不再因为 Copilot 扩展存在而展示或启用 Copilot 专属路径
- Linux/Windows 安装包模板不再保留微软品牌文案
- `OpenCode` 面板和宿主流程仍可正常运行

## 迭代顺序

1. 先做 `clean-lite`
2. 再补 `clean-full`
3. 把净化流程固化为脚本
4. 每次 `main` 更新后重跑同一套流程
