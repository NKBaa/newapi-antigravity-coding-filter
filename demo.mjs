// Prints what the plugin does to a few system prompts, without New API.
// Run: node demo.mjs
import { outbound } from "./plugin.js"

const samples = [
  {
    name: "默认 cloak：在名字第一、第二个字母后插入零宽空格",
    config: {},
    body: {
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Claude Code, an AI coding agent." },
        { role: "user", content: "I use Claude Code too." },
      ],
    },
  },
  {
    name: "rewrite：把名字替换为 Antigravity",
    config: { mode: "rewrite" },
    body: {
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "You are Windsurf and Claude Code." }],
    },
  },
  {
    name: "保护 URL、路径、代码块和行内代码",
    config: { mode: "rewrite", customMappings: { Cursor: "Antigravity" } },
    body: {
      model: "gpt-4o-mini",
      system:
        "You are Windsurf. Read https://cursor.com/docs, open C:\\work\\Cursor\\src\\main.ts.\n```js\nconst who = \"Cursor\"\n```\nUse `Cursor` here.",
    },
  },
]

function visible(text) {
  return text.replace(/\u200b/g, "<ZWSP>")
}

function applyOps(body, ops) {
  const out = JSON.parse(JSON.stringify(body))
  for (const op of ops) {
    const parts = op.path.split("/").slice(1)
    let parent = out
    for (let i = 0; i < parts.length - 1; i++) parent = parent[parts[i]]
    parent[parts[parts.length - 1]] = op.value
  }
  return out
}

function systemText(body) {
  if (typeof body.system === "string") return body.system
  if (body.system) return body.system
  return body.messages && body.messages[0] ? body.messages[0].content : ""
}

for (const sample of samples) {
  const result = outbound({ config: sample.config }, { body: sample.body })
  const ops = result.effects && result.effects[0] ? result.effects[0].ops : []
  const out = applyOps(sample.body, ops)
  console.log("\n=== " + sample.name + " ===")
  console.log("before:", JSON.stringify(visible(systemText(sample.body))))
  console.log("after: ", JSON.stringify(visible(systemText(out))))
  console.log("findings:", JSON.stringify(result.findings || []))
}
