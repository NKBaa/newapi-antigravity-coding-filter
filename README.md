# newapi-antigravity-coding-filter

把 magpie-antigravity-coding-filter 移植成 **New API 请求处理插件**（Request Processing Plugin，Plugin API v1）。它只在发往 **Antigravity 渠道** 的请求上，改写或隐藏系统/开发者提示词里其他编码代理的名字，避免上游把该提示词当成别的编码代理而返回 `429 Resource has been exhausted`（额度其实还在）。

> English summary: a New API request plugin that cloaks or rewrites other coding agents' names in the system prompt sent to Antigravity channels. Bind the instance to those channels only; user turns, tool definitions and tool results are never touched.

## 环境要求

- New API **v1.0.0-rc.50 或更新版本**（包含“请求处理插件 / Request processing plugins”与 Plugin API v1）。
- Root（超级管理员）权限：上传插件、创建请求插件实例、编辑渠道。

## 安装

1. **上传插件**：以 Root 登录 New API，进入管理台的插件页面（任务插件 / Plugins），使用“上传插件 / Upload plugin”选择本目录的 [`plugin.js`](plugin.js)，保存并启用。
2. **创建实例**：打开“请求插件 / Request plugins”设置，新建一个实例：
   - 插件选择 **Antigravity coding filter**；
   - 按需填写下面的配置（默认值即可直接使用）；
   - **作用域不要选全局**，保持为空或仅通过渠道绑定。
3. **绑定到 Antigravity 渠道**：编辑 Antigravity 对应的渠道，在“请求插件 / request_plugins”中按顺序加入刚才的实例。这样该实例只在这个渠道的请求上运行，其它渠道完全不受影响。
4. **先试运行**：使用宿主的“试运行 / dry run”功能查看会生成的 JSON Patch 和命中的名字；正式请求的日志会在 `other.request_plugins` 中记录每个实例改动的路径和命中数（**不记录原文**）。

> ⚠️ **不要对渠道开启请求体透传**（`pass_through_body_enabled` / Pass-through body）。New API 在透传渠道上不会运行 `outbound` 钩子，本插件将无法改写系统提示词。若必须透传，本插件不适用。

> 说明：请求处理插件**不受“任务插件总开关”影响**，关掉任务插件总开关它也照常运行；但只有被实例作用域覆盖到的请求才会执行。不要创建全局实例，也不要把它绑定到非 Antigravity 渠道。

## 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `mode` | `cloak` | `cloak`：在名字第一、第二个字母后各插入一个零宽空格（U+200B），模型照读，字面串变了；`rewrite`：把匹配到的名字替换为映射值（默认 `Antigravity`）。 |
| `useDefaultKeywords` | `true` | 启用内置的 48 条名称（编码代理、终端代理、聊天客户端）。关闭后只使用 `customMappings`。 |
| `useModelKeywords` | `false` | 额外匹配模型名：`Claude Sonnet`、`Claude Opus`、`Claude Haiku`、`Claude`、`GPT-5`、`GPT-4o`、`GPT-4.1`、`GPT-4`、`GPT-3.5`、`Gemini 3/2.5/2.0` 等。模型名本身也可能单独触发 429，需要时打开。 |
| `useAmbiguousKeywords` | `false` | 把 11 个本身是普通英文词的名称加回来：Aider、Cline、Codex、Cursor、Devin、Goose、Hermes、Kiro、Qodo、Tabby、Trae。默认不加入，避免把 `move the cursor`、`goose bumps`、`the tabby cat` 改坏。 |
| `boundaries` | `true` | 只匹配完整名称；`Traefik`、`decline`、`Kirov` 不会被当成 `Trae`、`Cline`、`Kiro`。设为 `false` 恢复上游插件的子串匹配。 |
| `protectCode` | `true` | 代码块和行内代码里的名称保持不变，避免改坏示例里的字符串字面量。 |
| `strictCase` | `false` | 让 11 个歧义名称只在原样大小写时匹配；小写身份行仍会被处理是默认行为。 |
| `customMappings` | `{}` | JSON 对象，添加或覆盖名称；值为 `null` 表示删除某个内置名称。 |

`customMappings` 示例：

```json
{
  "Cursor": "Antigravity",
  "My Agent": "Antigravity",
  "Windsurf": null
}
```

## 只处理哪些内容

只读取 **system / developer 提示词**，不改用户消息、助手消息、工具定义、工具结果、metadata 或图片。

| 协议 | 读取位置 |
|---|---|
| OpenAI Chat Completions | `messages` 中 role 为 `system` / `developer` 的内容（字符串、单个文本对象或文本块） |
| OpenAI Responses | `instructions`、`input` 为字符串，以及 `input` / `messages` 中 role 为 `system` / `developer` 的项 |
| Claude Messages | 顶层 `system`（字符串或文本块），以及 role 为 `system` / `developer` 的消息 |
| Gemini GenerateContent | `systemInstruction` / `system_instruction`（字符串或 `{parts}`），以及 `contents` 中 role 为 `system` / `developer` 的项 |

提示词里的技术引用保持不动：URL、`mcp__…` 标识符、Windows/POSIX 路径、`./`、`../`、`.codex`、`*.md` 文件名；开启 `protectCode` 时代码块和行内代码也不动。

## 与 magpie 版的差异

| | magpie 中间件 | 本插件（New API） |
|---|---|---|
| 生效范围 | `onProvider` 上判断 `provider.account === "antigravity"` | 由宿主按实例作用域运行；**必须把实例绑定到 Antigravity 渠道**，不要用全局实例 |
| 配置入口 | 插件选项 + 自带页面 | New API 管理台由 `configSchema` 生成的表单 |
| 触发阶段 | `onProvider`（每次尝试） | `outbound`（每次渠道尝试，改写上游 JSON body） |
| 结果记录 | `ctx.state["antigravity-coding-filter"]` | 返回 `findings`，宿主写入使用日志的 `request_plugins` |
| 试运行 | 自带 `dryRun` / `report` 选项 | 使用宿主自带的 dry run |
| 代码保护 / 边界 / 歧义词 | 支持 | 同样支持 |
| 渠道透传 | 不涉及 | **透传渠道不运行 `outbound`，不能用** |

## 测试

`plugin.js` 是单文件同步 ESM。仓库自带直接调用 `outbound` 并应用 JSON Patch 的测试：

```sh
npm test
# 或
node --test test/
```

如果本机有 New API 可执行文件，还可以用官方 CLI 校验插件和钩子行为：

```sh
new-api plugin lint plugin.js
new-api plugin test plugin.js --fixture test/golden.json
```

## 风险提示

- 本插件修改发给 Google 的请求，使原本会被拒绝的请求不被拒绝；这可能违反 Antigravity 服务条款，账号有被封禁的风险，请仅用于你能承受损失的账号。
- Google 可能随时改变匹配规则；若 `cloak` 失效，可尝试 `rewrite` 或在 `customMappings` 中更换写法。

---

## English summary

A New API **request processing plugin** (Plugin API v1, new-api v1.0.0-rc.50+) port of the magpie middleware. It reads only the system/developer prompt and either inserts zero-width spaces after the first two letters of each matched name (`cloak`) or replaces the name (`rewrite`, default `Antigravity`). Scope it by binding the instance to the Antigravity channel's `request_plugins`; do not use a global instance. The plugin does not run on pass-through channels. It handles OpenAI Chat, OpenAI Responses, Claude Messages and Gemini GenerateContent bodies, protects URLs/paths/`mcp__`/`.codex`/`*.md` and (optionally) code fences. Tests: `node --test test/`.
