// Tests for the New API request plugin. They call the outbound hook directly
// and apply its json.patch operations, which is what the host does; they do
// not need a running New API instance.
import { test } from "node:test"
import assert from "node:assert/strict"
import { meta, outbound, validateConfig } from "../plugin.js"

function decode(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~")
}

function applyOps(body, ops) {
  const out = JSON.parse(JSON.stringify(body))
  for (const op of ops) {
    assert.equal(op.op, "replace")
    const parts = op.path.split("/").slice(1).map(decode)
    let parent = out
    for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]]
    parent[parts[parts.length - 1]] = op.value
  }
  return out
}

// run returns the patched body and the hook result.
function run(body, config = {}) {
  const result = outbound({ config }, { body })
  assert.equal(result.action, "continue")
  const effects = result.effects || []
  const ops = effects.length ? effects[0].ops : []
  return { body: applyOps(body, ops), result, ops }
}

const KEY = "antigravity-coding-filter"

test("meta describes a request-only plugin, not a task or provider plugin", () => {
  assert.equal(meta.apiVersion, 1)
  assert.equal(meta.key, KEY)
  assert.equal(meta.version, "1.0.0")
  assert.equal(meta.optional, true)
  assert.equal(meta.fetchMode, undefined)
  assert.equal(meta.models, undefined)
  assert.equal(meta.relay, undefined)
  assert.ok(meta.configSchema && meta.configSchema.type === "object")
  assert.ok(Array.isArray(meta.samples) && meta.samples.length > 0)
})

test("cloak mode cloaks a Chat Completions system message and leaves the user turn", () => {
  const body = {
    model: "m",
    messages: [
      { role: "system", content: "You are Claude Code, an AI coding agent." },
      { role: "user", content: "I use Claude Code too." },
    ],
  }
  const { body: out, result } = run(body)
  assert.equal(out.messages[0].content, "You are C\u200bl\u200baude C\u200bo\u200bde, an AI coding agent.")
  assert.equal(out.messages[1].content, "I use Claude Code too.")
  assert.deepEqual(result.findings, [
    { rule: "Claude Code", category: "coding-agent", count: 1 },
  ])
})

test("rewrite mode replaces every preset name with Antigravity", () => {
  const body = { model: "m", messages: [{ role: "system", content: "You are Windsurf and Cursor." }] }
  const { body: out } = run(body, { mode: "rewrite", customMappings: { Cursor: "Antigravity" } })
  assert.equal(out.messages[0].content, "You are Antigravity and Antigravity.")
})

test("Anthropic top-level system, as a string and as text blocks", () => {
  for (const system of [
    "You are Claude Agent.",
    [{ type: "text", text: "You are Claude Agent." }],
    { type: "text", text: "You are Claude Agent." },
  ]) {
    const { body: out } = run({ model: "m", system, messages: [] }, { mode: "rewrite" })
    const text =
      typeof out.system === "string"
        ? out.system
        : Array.isArray(out.system)
          ? out.system[0].text
          : out.system.text
    assert.equal(text, "You are Antigravity.")
  }
})

test("Responses instructions and developer input items are read", () => {
  const body = {
    model: "m",
    instructions: "You are Codex CLI.",
    input: [
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Inside Cline." }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Trae?" }] },
    ],
  }
  const { body: out } = run(body, { mode: "rewrite", customMappings: { Cline: "Antigravity", Trae: "Antigravity" } })
  assert.equal(out.instructions, "You are Antigravity.")
  assert.equal(out.input[0].content[0].text, "Inside Antigravity.")
  assert.equal(out.input[1].content[0].text, "Trae?")
})

test("Gemini systemInstruction and a system role in contents are read", () => {
  const body = {
    model: "m",
    systemInstruction: { parts: [{ text: "You are Windsurf." }] },
    contents: [
      { role: "user", parts: [{ text: "Trae?" }] },
      { role: "system", parts: [{ text: "You are Kelivo." }] },
    ],
  }
  const { body: out } = run(body, { mode: "rewrite" })
  assert.equal(out.systemInstruction.parts[0].text, "You are Antigravity.")
  assert.equal(out.contents[0].parts[0].text, "Trae?")
  assert.equal(out.contents[1].parts[0].text, "You are Antigravity.")
})

test("technical references and code are protected", () => {
  const body = {
    model: "m",
    system:
      "You are Windsurf. Read https://cursor.com/docs, open C:\\work\\Cursor\\src\\main.ts, see cursor.md, .codex/Cursor/rules.md and mcp__x__Cursor.\n```js\nconst who = \"Cursor\"\n```\nUse `Cursor` here.",
  }
  const { body: out } = run(body, { mode: "rewrite", customMappings: { Cursor: "Antigravity" } })
  const text = out.system
  assert.ok(text.startsWith("You are Antigravity."))
  assert.ok(text.indexOf("https://cursor.com/docs") >= 0)
  assert.ok(text.indexOf("C:\\work\\Cursor\\src\\main.ts") >= 0)
  assert.ok(text.indexOf("cursor.md") >= 0)
  assert.ok(text.indexOf(".codex/Cursor/rules.md") >= 0)
  assert.ok(text.indexOf("mcp__x__Cursor") >= 0)
  assert.ok(text.indexOf('const who = "Cursor"') >= 0)
  assert.ok(text.indexOf("Use `Cursor` here.") >= 0)
})

test("protectCode off rewrites names inside code", () => {
  const body = { model: "m", system: '```js\nconst who = "Cursor"\n```' }
  const { body: out } = run(body, { mode: "rewrite", protectCode: false, customMappings: { Cursor: "Antigravity" } })
  assert.equal(out.system, '```js\nconst who = "Antigravity"\n```')
})

test("the preset is on by default; useDefaultKeywords false leaves only customMappings", () => {
  const body = { model: "m", system: "You are Windsurf and Cursor." }
  const off = run(body, { useDefaultKeywords: false, customMappings: { Cursor: "Antigravity" }, mode: "rewrite" })
  assert.equal(off.body.system, "You are Windsurf and Antigravity.")
})

test("ambiguous names are out by default and come back with one switch", () => {
  const body = { model: "m", system: "You are Cursor." }
  assert.equal(run(body, { mode: "rewrite" }).body.system, "You are Cursor.")
  assert.equal(
    run(body, { mode: "rewrite", useAmbiguousKeywords: true }).body.system,
    "You are Antigravity."
  )
})

test("strictCase keeps a lower-case ordinary word out", () => {
  const body = { model: "m", system: "Move the cursor to the end. You are Cursor." }
  const { body: out } = run(body, {
    mode: "rewrite",
    useAmbiguousKeywords: true,
    strictCase: true,
  })
  assert.ok(out.system.startsWith("Move the cursor to the end."))
  assert.ok(out.system.endsWith("You are Antigravity."))
})

test("boundaries keeps a name glued to another word alone", () => {
  const body = { model: "m", system: "Windsurfing is fun." }
  assert.equal(run(body, { mode: "rewrite" }).body.system, "Windsurfing is fun.")
  assert.notEqual(
    run(body, { mode: "rewrite", boundaries: false }).body.system,
    "Windsurfing is fun."
  )
})

test("model names are off by default and on with useModelKeywords", () => {
  const body = { model: "m", system: "You are Claude Sonnet." }
  assert.equal(run(body, { mode: "rewrite" }).body.system, "You are Claude Sonnet.")
  assert.equal(
    run(body, { mode: "rewrite", useModelKeywords: true }).body.system,
    "You are Antigravity."
  )
})

test("custom mappings add, override and remove names", () => {
  const added = run(
    { model: "m", system: "You are My Agent and Windsurf." },
    { mode: "rewrite", customMappings: { "My Agent": "Example", Windsurf: null } }
  )
  assert.equal(added.body.system, "You are Example and Windsurf.")
})

test("a mapping to the same name changes nothing", () => {
  const result = outbound(
    { config: { mode: "rewrite", customMappings: { Windsurf: "Windsurf" } } },
    { body: { model: "m", system: "You are Windsurf." } }
  )
  assert.equal(result.effects, undefined)
  assert.deepEqual(result.findings, [
    { rule: "Windsurf", category: "coding-agent", count: 1 },
  ])
})

test("no system prompt means no work", () => {
  const result = outbound(
    { config: {} },
    { body: { model: "m", messages: [{ role: "user", content: "You are Windsurf." }] } }
  )
  assert.deepEqual(result, { action: "continue" })
})

test("validateConfig rejects a malformed custom mapping", () => {
  assert.throws(() => validateConfig({ customMappings: [] }), /must be a JSON object/)
  assert.throws(() => validateConfig({ customMappings: { "": "X" } }), /empty name/)
  assert.throws(() => validateConfig({ customMappings: { Cursor: 3 } }), /string or null/)
  assert.doesNotThrow(() => validateConfig({ customMappings: { Cursor: "X", Windsurf: null } }))
})
