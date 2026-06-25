const http = require("http")
const https = require("https")

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com"

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  })
  res.end(body)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", chunk => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"))
        req.destroy()
      }
    })
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(new Error("请求 JSON 格式错误"))
      }
    })
    req.on("error", reject)
  })
}

function callOpenAIImage({ prompt, size }) {
  const baseUrl = new URL(OPENAI_BASE_URL)
  const payload = JSON.stringify({
    model: "gpt-image-1",
    prompt,
    size: size || "1024x1024",
    quality: "low",
    n: 1
  })

  const options = {
    hostname: baseUrl.hostname,
    port: baseUrl.port || 443,
    path: "/v1/images/generations",
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
    timeout: 180000
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (apiRes) => {
      let body = ""
      apiRes.on("data", chunk => {
        body += chunk
      })
      apiRes.on("end", () => {
        let json
        try {
          json = JSON.parse(body)
        } catch (error) {
          reject(new Error(`OpenAI 返回内容无法解析：${body.slice(0, 300)}`))
          return
        }

        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          reject(new Error(json.error ? json.error.message : `OpenAI 请求失败：${apiRes.statusCode}`))
          return
        }

        resolve(json)
      })
    })

    req.on("timeout", () => {
      req.destroy(new Error("连接图片生成接口超时。请检查当前网络是否能访问 OpenAI API，或配置可用的 OPENAI_BASE_URL 中转地址。"))
    })
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

async function handleGenerateImage(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, {
      ok: false,
      error: "服务端未配置 OPENAI_API_KEY"
    })
    return
  }

  const body = await readJson(req)
  const prompt = String(body.prompt || "").trim()
  const size = String(body.size || "1024x1024")

  if (!prompt) {
    sendJson(res, 400, {
      ok: false,
      error: "缺少 prompt"
    })
    return
  }

  const result = await callOpenAIImage({ prompt, size })
  const imageBase64 = result.data && result.data[0] ? result.data[0].b64_json : ""

  if (!imageBase64) {
    sendJson(res, 502, {
      ok: false,
      error: "OpenAI 未返回图片"
    })
    return
  }

  sendJson(res, 200, {
    ok: true,
    imageBase64
  })
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      sendJson(res, 200, {
        ok: true,
        service: "gym-ai-image-backend",
        hasApiKey: Boolean(OPENAI_API_KEY),
        baseUrl: OPENAI_BASE_URL
      })
      return
    }

    if (req.method === "POST" && req.url === "/api/generate-image") {
      await handleGenerateImage(req, res)
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: "接口不存在"
    })
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message
    })
  }
})

server.listen(PORT, () => {
  console.log(`Image backend listening on http://localhost:${PORT}`)
})
