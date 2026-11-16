// Antigravity coding filter — New API request plugin.
//
// A port of magpie-antigravity-coding-filter to New API's request processing
// plugin API (Plugin API v1, new-api v1.0.0-rc.50 and later). It does what the
// magpie middleware does: on the request sent to an Antigravity channel, look
// at the system/developer prompt only, and either rewrite the names of other
// coding agents to "Antigravity" or break them with zero-width spaces, so the
// upstream no longer reads the prompt as another agent's and answers with a
// 429 "Resource has been exhausted".
//
// New API has no "Antigravity account" hook like magpie's onProvider. Scoping
// is done by the host: a request plugin instance runs only where an
// administrator puts it — globally, by group, or bound to a channel through
// the channel's request_plugins setting. Bind this instance to the Antigravity
// channel(s) and leave other channels alone; a global instance would touch
// every channel.
//
// Only the system prompt is read: names in the user's or assistant's turns, in
// tool definitions or tool results, in metadata or in an image are left alone.
// What is preserved even inside the system prompt is the same list the magpie
// middleware protects: URLs, `mcp__…` identifiers, Windows and POSIX paths,
// `./` and `../`, `.codex`, and `*.md` file names. With protectCode on, code
// fences and inline code are protected too.
//
// This file is a single synchronous ECMAScript module, as the New API plugin
// host requires: no imports, no require, no async/await, no fetch and no
// filesystem or environment access.

// The preset is the Go plugin's 56 names minus the eleven that are also
// ordinary English words (ambiguousNames below), plus the chat clients
// Chatbox / Chatbox AI and Kelivo.
const defaultMappings = [
  // Major AI code editors, assistants, and terminal coding agents.
  ["Claude Agent", "Antigravity"],
  ["Claude Code", "Antigravity"],
  ["OpenAI Codex", "Antigravity"],
  ["Codex CLI", "Antigravity"],
  ["OpenCode", "Antigravity"],
  ["GitHub Copilot CLI", "Antigravity"],
  ["GitHub Copilot", "Antigravity"],
  ["Gemini Code Assist", "Antigravity"],
  ["Gemini CLI", "Antigravity"],
  ["Windsurf", "Antigravity"],
  ["Codeium", "Antigravity"],
  ["Roo Code", "Antigravity"],
  ["Kilo Code", "Antigravity"],
  ["Continue.dev", "Antigravity"],
  ["Amazon Q Developer", "Antigravity"],
  ["Amazon CodeWhisperer", "Antigravity"],
  ["JetBrains AI Assistant", "Antigravity"],
  ["JetBrains Junie", "Antigravity"],
  ["Qoder CLI", "Antigravity"],
  ["Qoder", "Antigravity"],
  ["Qwen Code", "Antigravity"],
  ["Tabnine", "Antigravity"],
  ["Sourcegraph Cody", "Antigravity"],
  ["Augment Code", "Antigravity"],
  ["Replit Agent", "Antigravity"],
  ["Replit Ghostwriter", "Antigravity"],
  ["OpenHands", "Antigravity"],
  ["SWE-agent", "Antigravity"],
  ["Zed AI", "Antigravity"],
  ["Void Editor", "Antigravity"],
  ["PearAI", "Antigravity"],
  ["Refact.ai", "Antigravity"],
  ["GitLab Duo", "Antigravity"],
  ["Visual Studio IntelliCode", "Antigravity"],
  ["CodeBuddy", "Antigravity"],
  ["Blackbox AI", "Antigravity"],
  ["Pieces for Developers", "Antigravity"],
  ["CodiumAI", "Antigravity"],
  ["Rovo Dev CLI", "Antigravity"],
  ["Factory Droid", "Antigravity"],

  // General-purpose local agents that can generate and modify code.
  ["OpenClaw", "Antigravity"],
  ["Clawdbot", "Antigravity"],
  ["Moltbot", "Antigravity"],
  ["Hermes Agent", "Antigravity"],
  ["WorkBuddy", "Antigravity"],

  // Chat clients whose provider settings take any OpenAI-compatible host, so
  // their requests can reach an Antigravity channel through New API.
  ["Chatbox AI", "Antigravity"],
  ["Chatbox", "Antigravity"],
  ["Kelivo", "Antigravity"],
]

// modelMappings is off unless useModelKeywords is set. The preset leaves
// model names out on purpose (they are not agents), but the model name alone
// can bring the 429 back, so this list is here for prompts that name one.
const modelMappings = [
  ["Claude Sonnet", "Antigravity"],
  ["Claude Opus", "Antigravity"],
  ["Claude Haiku", "Antigravity"],
  ["Claude 4", "Antigravity"],
  ["Claude 3.7", "Antigravity"],
  ["Claude 3.5", "Antigravity"],
  ["Claude", "Antigravity"],
  ["GPT-5", "Antigravity"],
  ["GPT-4.5", "Antigravity"],
  ["GPT-4o", "Antigravity"],
  ["GPT-4.1", "Antigravity"],
  ["GPT-4", "Antigravity"],
  ["GPT-3.5", "Antigravity"],
  ["Gemini 3", "Antigravity"],
  ["Gemini 2.5", "Antigravity"],
  ["Gemini 2.0", "Antigravity"],
]

// The eleven names the Go plugin ships that are also ordinary English words or
// given names. They are out of the preset so "move the cursor", "goose bumps"
// and "the tabby cat" are not rewritten; a prompt that names one adds it with
// customMappings, or all of them come back with useAmbiguousKeywords.
const ambiguousNames = [
  "Aider",
  "Cline",
  "Codex",
  "Cursor",
  "Devin",
  "Goose",
  "Hermes",
  "Kiro",
  "Qodo",
  "Tabby",
  "Trae",
]

const ambiguousMappings = ambiguousNames.map(function (name) {
  return [name, "Antigravity"]
})

const ZWSP = "\u200b"
const DEFAULT_REPLACEMENT = "Antigravity"
const MAX_PATCH_OPS = 512
const TEXT_PART_TYPES = ["text", "input_text", "output_text"]
const MEDIA_PLACEHOLDER = /\[media:\d+\]/

export const meta = {
  apiVersion: 1,
  key: "antigravity-coding-filter",
  name: { en: "Antigravity coding filter", zh: "Antigravity 编码过滤" },
  description: {
    en: "Cloaks other coding agents' names sent to Antigravity channels",
    zh: "在发往 Antigravity 渠道的系统提示词中隐藏其他编码代理的名字",
  },
  version: "1.0.0",
  author: { name: "NKBaa" },
  // A failed instance lets the request go unchanged instead of stopping it,
  // which is what the magpie middleware does when a hook times out.
  optional: true,
  configSchema: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        title: { en: "Processing", zh: "处理方式" },
        description: {
          en: "Keep the wording with invisible characters, or replace each name",
          zh: "插入不可见字符保留原句，或替换每个名称",
        },
        enum: ["cloak", "rewrite"],
        enumTitles: [
          { en: "Keep wording", zh: "保留原文" },
          { en: "Replace names", zh: "替换名字" },
        ],
        default: "cloak",
      },
      useDefaultKeywords: {
        type: "boolean",
        title: { en: "Built-in names", zh: "内置名称" },
        description: {
          en: "Include the preset of coding agents and chat clients",
          zh: "包含内置的编码代理和聊天客户端名单",
        },
        default: true,
      },
      useModelKeywords: {
        type: "boolean",
        title: { en: "Model names", zh: "模型名称" },
        description: {
          en: "Also match model names such as Claude Sonnet and GPT-5",
          zh: "同时匹配 Claude Sonnet、GPT-5 等模型名称",
        },
        default: false,
      },
      useAmbiguousKeywords: {
        type: "boolean",
        title: { en: "Ambiguous names", zh: "歧义名称" },
        description: {
          en: "Include the eleven names that are also ordinary words",
          zh: "包含 11 个本身是普通单词的名称",
        },
        default: false,
      },
      boundaries: {
        type: "boolean",
        title: { en: "Whole names only", zh: "只匹配完整名称" },
        description: {
          en: "Do not match a name glued to another word or number",
          zh: "名称与其他字母或数字相连时不匹配",
        },
        default: true,
      },
      protectCode: {
        type: "boolean",
        title: { en: "Preserve code", zh: "保护代码" },
        description: {
          en: "Leave names inside code fences and inline code alone",
          zh: "代码块和行内代码中的名称保持不变",
        },
        default: true,
      },
      strictCase: {
        type: "boolean",
        title: { en: "Case-sensitive ambiguous names", zh: "歧义名称区分大小写" },
        description: {
          en: "The eleven ambiguous names match only in their own spelling",
          zh: "11 个歧义名称只在原样大小写时匹配",
        },
        default: false,
      },
      customMappings: {
        type: "object",
        format: "json",
        title: { en: "Custom mappings", zh: "自定义映射" },
        description: {
          en: "Extra name-to-replacement entries; a null value removes a preset name",
          zh: "额外的名称到替换值映射；值为 null 可删除内置名称",
        },
        default: {},
        examples: [{ Cursor: "Antigravity", Windsurf: "Antigravity" }],
      },
    },
  },
  samples: [
    {
      name: { en: "OpenAI Chat", zh: "OpenAI Chat" },
      lang: "en",
      format: "openai",
      body: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are Claude Code, an AI coding agent." },
          { role: "user", content: "Explain what this function does." },
        ],
      },
    },
    {
      name: { en: "Claude Messages", zh: "Claude Messages" },
      lang: "en",
      format: "claude",
      body: {
        model: "claude-sonnet-4-5",
        system: "You are Windsurf, an AI coding assistant.",
        messages: [{ role: "user", content: "Refactor this function." }],
      },
    },
    {
      name: { en: "Gemini GenerateContent", zh: "Gemini GenerateContent" },
      lang: "en",
      format: "gemini",
      body: {
        model: "gemini-2.5-pro",
        systemInstruction: { parts: [{ text: "You are Windsurf." }] },
        contents: [{ role: "user", parts: [{ text: "Write a unit test." }] }],
      },
    },
    {
      name: { en: "OpenAI Chat", zh: "OpenAI Chat" },
      lang: "zh",
      format: "openai",
      body: {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "你是 Chatbox，一个 AI 助手。" },
          { role: "user", content: "帮我解释这段代码。" },
        ],
      },
    },
  ],
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function pushText(fields, path, value) {
  if (typeof value === "string" && value !== "" && !MEDIA_PLACEHOLDER.test(value)) {
    fields.push({ path: path, text: value })
  }
}

// Message content: a string, a single text object, or text blocks in the
// OpenAI, Responses, Claude or Gemini shape. Non-text blocks are skipped.
function collectContent(fields, path, content) {
  if (typeof content === "string") {
    pushText(fields, path, content)
    return
  }
  if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      const part = content[i]
      const partPath = path + "/" + i
      if (typeof part === "string") {
        pushText(fields, partPath, part)
        continue
      }
      if (!isObject(part)) continue
      const type = typeof part.type === "string" ? part.type : ""
      if (type && TEXT_PART_TYPES.indexOf(type) < 0) continue
      if (typeof part.text === "string") pushText(fields, partPath + "/text", part.text)
    }
    return
  }
  if (isObject(content) && typeof content.text === "string") {
    pushText(fields, path + "/text", content.text)
  }
}

// Only system and developer messages are read.
function collectRoleMessages(fields, basePath, list) {
  if (!Array.isArray(list)) return
  for (let i = 0; i < list.length; i++) {
    const message = list[i]
    if (!isObject(message)) continue
    const role = typeof message.role === "string" ? message.role.toLowerCase() : ""
    if (role !== "system" && role !== "developer") continue
    if ("content" in message) collectContent(fields, basePath + "/" + i + "/content", message.content)
    if ("parts" in message) collectGeminiParts(fields, basePath + "/" + i + "/parts", message.parts)
  }
}

function collectGeminiParts(fields, path, parts) {
  if (!Array.isArray(parts)) return
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (isObject(part) && typeof part.text === "string") pushText(fields, path + "/" + i + "/text", part.text)
  }
}

// Collects the system/developer prompt text of a request in any of the four
// APIs' shapes, with the JSON Pointer of every string. Nothing outside the
// system prompt is returned.
function collectSystemTexts(body) {
  const fields = []
  if (!isObject(body)) return fields
  if (body.system !== undefined) collectContent(fields, "/system", body.system)
  collectRoleMessages(fields, "/messages", body.messages)
  if (typeof body.instructions === "string") pushText(fields, "/instructions", body.instructions)
  if (typeof body.input === "string") pushText(fields, "/input", body.input)
  collectRoleMessages(fields, "/input", body.input)
  for (let k = 0; k < 2; k++) {
    const key = k === 0 ? "systemInstruction" : "system_instruction"
    const value = body[key]
    if (typeof value === "string") pushText(fields, "/" + key, value)
    else if (isObject(value)) collectGeminiParts(fields, "/" + key + "/parts", value.parts)
  }
  if (Array.isArray(body.contents)) {
    for (let i = 0; i < body.contents.length; i++) {
      const content = body.contents[i]
      if (!isObject(content)) continue
      const role = typeof content.role === "string" ? content.role.toLowerCase() : ""
      if (role !== "system" && role !== "developer") continue
      collectGeminiParts(fields, "/contents/" + i + "/parts", content.parts)
    }
  }
  return fields
}

// parseCustom reads customMappings: an object {"Cursor": "Antigravity"}, a
// comma- or newline-delimited string, or an array of such strings. This keeps
// the magpie middleware's option shapes working even though the schema shows
// a JSON object.
function parseCustom(value) {
  if (value == null) return []
  if (typeof value === "string") return parseMappingString(value)
  if (Array.isArray(value)) {
    const out = []
    for (let i = 0; i < value.length; i++) {
      const item = value[i]
      if (typeof item === "string") out.push.apply(out, parseMappingString(item))
      else if (isObject(item)) {
        const keys = Object.keys(item)
        for (let j = 0; j < keys.length; j++) out.push([keys[j], item[keys[j]]])
      }
    }
    return out
  }
  if (isObject(value)) {
    const out = []
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i++) out.push([keys[i], value[keys[i]]])
    return out
  }
  return []
}

function parseMappingString(value) {
  const entries = /[\r\n]/.test(value) ? value.split(/[\r\n]+/) : value.split(",")
  const out = []
  for (let i = 0; i < entries.length; i++) {
    const text = entries[i].trim()
    if (!text) continue
    const at = text.indexOf(":")
    if (at < 0) out.push([text, ""])
    else out.push([text.slice(0, at), text.slice(at + 1)])
  }
  return out
}

function buildMatcher(list, boundaries, strict) {
  const byLower = Object.create(null)
  for (let i = 0; i < list.length; i++) byLower[list[i].match] = list[i].replacement
  const escaped = []
  for (let i = 0; i < list.length; i++) escaped.push(list[i].match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const source = escaped.join("|")
  return boundaries
    ? {
        re: new RegExp("(^|[^A-Za-z0-9_])(" + source + ")(?![A-Za-z0-9_])", "gi"),
        byLower: byLower,
        grouped: true,
        strict: strict,
      }
    : { re: new RegExp(source, "gi"), byLower: byLower, grouped: false, strict: strict }
}

// buildConfig turns the instance config into the matcher the hook uses.
function buildConfig(config) {
  config = isObject(config) ? config : {}
  const mode = String(config.mode || "").trim().toLowerCase() === "rewrite" ? "rewrite" : "cloak"
  const useDefault = config.useDefaultKeywords !== false
  const useModels = config.useModelKeywords === true
  const useAmbiguous = config.useAmbiguousKeywords === true
  const boundaries = config.boundaries !== false
  const protectCode = config.protectCode !== false
  const strictCase = config.strictCase === true

  const pairs = []
  if (useDefault) for (let i = 0; i < defaultMappings.length; i++) pairs.push(defaultMappings[i])
  if (useModels) for (let i = 0; i < modelMappings.length; i++) pairs.push(modelMappings[i])
  if (useAmbiguous) for (let i = 0; i < ambiguousMappings.length; i++) pairs.push(ambiguousMappings[i])
  const customPairs = parseCustom(config.customMappings)
  for (let i = 0; i < customPairs.length; i++) pairs.push(customPairs[i])

  // Later entries win, matched ignoring case. A null replacement removes a
  // name; a blank replacement is skipped.
  const seen = Object.create(null)
  const spelling = Object.create(null)
  for (let i = 0; i < pairs.length; i++) {
    const match = pairs[i][0]
    const replacement = pairs[i][1]
    const name = String(match == null ? "" : match).trim()
    if (!name) continue
    const lower = name.toLowerCase()
    if (replacement === null) {
      delete seen[lower]
      delete spelling[lower]
      continue
    }
    const value = String(replacement == null ? "" : replacement).trim()
    if (!value) continue
    seen[lower] = value
    spelling[lower] = name
  }
  const list = Object.keys(seen).map(function (match) {
    return { match: match, replacement: seen[match] }
  })
  list.sort(function (a, b) {
    return b.match.length - a.match.length || (a.match < b.match ? -1 : 1)
  })

  let strict = null
  if (strictCase) {
    for (let i = 0; i < ambiguousNames.length; i++) {
      const name = ambiguousNames[i]
      const lower = name.toLowerCase()
      if (!seen[lower]) continue
      strict = strict || Object.create(null)
      strict[lower] = spelling[lower] || name
    }
  }

  return {
    mode: mode,
    protectCode: protectCode,
    matcher: list.length ? buildMatcher(list, boundaries, strict) : null,
  }
}

// protectedSpans lists the ranges a name must not be rewritten in: URLs,
// mcp__ identifiers, paths, .codex, and .md file names. With protectCode, code
// fences and inline code are protected too.
const PROTECTED = [
  /https?:\/\/[^\s"'<>]+/gi,
  /\bmcp__[A-Za-z0-9][A-Za-z0-9_-]*/gi,
  /\b[A-Za-z]:[\\/][^\s"'<>]+/g,
  /(?:\\\\|\/\/)[^\s"'<>]+/g,
  /(?:^|[^A-Za-z0-9])\/(?:[^\s"'<>/]+\/)+[^\s"'<>]*/g,
  /(?:^|[^A-Za-z0-9])(?:[A-Za-z0-9._~-]+[\\/])+[A-Za-z0-9._~-]+/g,
  /(?:^|[^A-Za-z0-9])(?:~|\.{1,2})[\\/][^\s"'<>]+/g,
  /\.codex(?:[^A-Za-z0-9]|$)/gi,
  /(?:^|[^A-Za-z0-9])[A-Za-z0-9_-]+\.(?:md|markdown)/gi,
]

const CODE = [/```[\s\S]*?```/g, /`[^`\n]*`/g]

function protectedSpans(text, cfg) {
  const spans = []
  const patterns = cfg.protectCode ? PROTECTED.concat(CODE) : PROTECTED
  for (let p = 0; p < patterns.length; p++) {
    const re = patterns[p]
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++
        continue
      }
      spans.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return merge(spans)
}

function merge(spans) {
  if (spans.length < 2) return spans
  spans.sort(function (a, b) {
    return a.start - b.start
  })
  const out = [spans[0]]
  for (let i = 1; i < spans.length; i++) {
    const span = spans[i]
    const top = out[out.length - 1]
    if (span.start <= top.end) {
      if (span.end > top.end) top.end = span.end
    } else out.push(span)
  }
  return out
}

// transform rewrites or cloaks every match that is not inside a protected
// technical reference, and hands each matched name to onMatch.
function transform(text, cfg, onMatch) {
  const matcher = cfg.matcher
  const re = matcher.re
  const byLower = matcher.byLower
  const grouped = matcher.grouped
  const strict = matcher.strict
  const spans = protectedSpans(text, cfg)
  let out = ""
  let last = 0
  let at = 0
  let changed = false
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) {
    const prefix = grouped ? m[1] || "" : ""
    const name = grouped ? m[2] : m[0]
    const start = m.index + prefix.length
    const end = start + name.length
    if (end === start) {
      re.lastIndex++
      continue
    }
    const lower = name.toLowerCase()
    if (strict && strict[lower] !== undefined && strict[lower] !== name) continue
    while (at < spans.length && spans[at].end <= start) at++
    if (at < spans.length && spans[at].start < end) continue
    const replacement = cfg.mode === "cloak" ? cloakWord(name) : byLower[lower] || DEFAULT_REPLACEMENT
    if (onMatch) onMatch(name)
    // A name short enough to cloak to itself, or a mapping that maps a name to
    // itself, changes nothing.
    if (replacement === name) {
      out += text.slice(last, end)
      last = end
      continue
    }
    out += text.slice(last, start)
    out += replacement
    last = end
    changed = true
  }
  if (!changed) return text
  return out + text.slice(last)
}

// cloakWord puts a zero-width space after the first and after the second
// letter of every run of three or more letters or digits.
function cloakWord(text) {
  return text.replace(/[A-Za-z0-9]{3,}/g, function (word) {
    return word[0] + ZWSP + word[1] + ZWSP + word.slice(2)
  })
}

// Runs when an instance is saved, so a bad custom mapping is refused there
// instead of failing every request.
export function validateConfig(config) {
  config = isObject(config) ? config : {}
  const custom = config.customMappings
  if (custom === undefined || custom === null) return
  if (!isObject(custom)) throw new Error("customMappings must be a JSON object")
  const names = Object.keys(custom)
  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    if (!String(name).trim()) throw new Error("customMappings contains an empty name")
    const value = custom[name]
    if (value !== null && typeof value !== "string") {
      throw new Error('customMappings["' + name + '"] must be a string or null')
    }
  }
}

// outbound runs on the body built for the upstream channel, before the
// channel's parameter override. Bind the instance to the Antigravity channel.
// The result is an RFC 6902 json.patch of every changed system-prompt string;
// the host applies it, so user turns and tool definitions stay untouched.
export function outbound(ctx, req) {
  const body = req && req.body
  if (!isObject(body)) return { action: "continue" }
  const cfg = buildConfig(ctx && ctx.config)
  if (!cfg.matcher) return { action: "continue" }

  const fields = collectSystemTexts(body)
  const hits = new Map()
  const ops = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    const next = transform(field.text, cfg, function (name) {
      hits.set(name, (hits.get(name) || 0) + 1)
    })
    if (next !== field.text) ops.push({ op: "replace", path: field.path, value: next })
  }

  const findings = []
  hits.forEach(function (count, name) {
    findings.push({ rule: name, category: "coding-agent", count: count })
  })
  // The host takes at most 64 findings; a request that matches more still gets
  // its patch, just with the extra finding entries trimmed.
  if (findings.length > 64) findings.length = 64

  if (ops.length === 0) {
    return findings.length ? { action: "continue", findings: findings } : { action: "continue" }
  }
  // The host takes at most 512 json.patch operations from one result. A system
  // prompt with more system/developer strings than that is not a realistic
  // request; keeping the first 512 is better than failing the instance.
  if (ops.length > MAX_PATCH_OPS) ops.length = MAX_PATCH_OPS
  return {
    action: "continue",
    effects: [{ type: "json.patch", ops: ops }],
    findings: findings,
  }
}
