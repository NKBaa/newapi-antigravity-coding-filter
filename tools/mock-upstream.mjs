// A tiny OpenAI-compatible upstream for a local New API experiment. It prints
// every request body it receives and answers with a fixed Chat Completions
// response, so you can see the system prompt New API actually sent.
//
// Run: node tools/mock-upstream.mjs
// Then point a New API OpenAI channel at http://127.0.0.1:8787
import http from "node:http"

const port = Number(process.env.PORT || 8787)

const server = http.createServer((req, res) => {
  const chunks = []
  req.on("data", (chunk) => chunks.push(chunk))
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8")
    console.log("\n=== " + req.method + " " + req.url + " ===")
    try {
      console.log(JSON.stringify(JSON.parse(raw), null, 2))
    } catch {
      console.log(raw)
    }
    console.log(
      "zero-width spaces in raw body:",
      (raw.match(/\u200b/g) || []).length
    )
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4o-mini",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "mock reply" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    )
  })
})

server.listen(port, "127.0.0.1", () => {
  console.log("mock upstream listening on http://127.0.0.1:" + port)
})
