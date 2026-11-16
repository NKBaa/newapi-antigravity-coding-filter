// Runs the magpie middleware's cases.json against the New API plugin. Cases
// that depend on magpie's provider-account scoping or its off/dryRun options
// are skipped: New API scopes by channel binding and has its own dry run.
// Everything else must produce the same outgoing body.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { outbound } from "../plugin.js"

const cases = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cases.json"), "utf8")
)

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

function isOn(value) {
  if (value === true) return true
  if (typeof value === "number") return value !== 0
  if (typeof value !== "string") return false
  const v = value.trim().toLowerCase()
  return v === "true" || v === "1" || v === "yes" || v === "on"
}

function appliesToAntigravity(c) {
  const account = c.provider && c.provider.account
  return typeof account === "string" && account.toLowerCase() === "antigravity"
}

for (const c of cases) {
  test(c.name, () => {
    if (!c.request) return
    if (!appliesToAntigravity(c)) return
    const options = c.options || {}
    if (isOn(options.off)) return
    if (options.dryRun === true) return
    const body = JSON.parse(JSON.stringify(c.request))
    const result = outbound({ config: options }, { body })
    const ops = result.effects && result.effects[0] ? result.effects[0].ops : []
    assert.deepEqual(applyOps(body, ops), c.expect_request || c.request)
  })
}
