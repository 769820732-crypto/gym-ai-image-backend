const http = require("http")
const https = require("https")

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com"
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1"

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
        reject(new Error("Request body is too large."))
        req.destroy()
      }
    })
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(new Error("Invalid JSON request body."))
      }
    })
    req.on("error", reject)
  })
}

function normalizeBaseUrl() {
  const baseUrl = new URL(OPENAI_BASE_URL)
  return {
    hostname: baseUrl.hostname,
    port: baseUrl.port || 443,
    pathname: baseUrl.pathname.replace(/\/$/, "")
  }
}

function callImageApi({ prompt, size }) {
  const baseUrl = normalizeBaseUrl()
  const payload = JSON.stringify({
    model: IMAGE_MODEL,
    prompt,
    size: size || "1024x1024",
    quality: "low",
    n: 1
  })

  const options = {
    hostname: baseUrl.hostname,
    port: baseUrl.port,
    path: `${baseUrl.pathname}/v1/images/generations`,
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
          reject(new Error(`Image API returned invalid JSON: ${body.slice(0, 300)}`))
          return
        }

        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          reject(new Error(json.error ? json.error.message : `Image API request failed: ${apiRes.statusCode}`))
          return
        }

        resolve(json)
      })
    })

    req.on("timeout", () => {
      req.destroy(new Error("Image API request timed out."))
    })
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

function getImageFromResult(result) {
  const firstData = result.data && result.data[0] ? result.data[0] : {}
  const firstImage = result.images && result.images[0] ? result.images[0] : {}

  return {
    imageBase64: firstData.b64_json || firstImage.b64_json || "",
    imageUrl: firstData.url || firstImage.url || ""
  }
}

async function handleGenerateImage(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 500, {
      ok: false,
      error: "Server missing OPENAI_API_KEY."
    })
    return
  }

  const body = await readJson(req)
  const prompt = String(body.prompt || "").trim()
  const size = String(body.size || "1024x1024")

  if (!prompt) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing prompt."
    })
    return
  }

  const result = await callImageApi({ prompt, size })
  const { imageBase64, imageUrl } = getImageFromResult(result)

  if (!imageBase64 && !imageUrl) {
    sendJson(res, 502, {
      ok: false,
      error: "Image API did not return an image."
    })
    return
  }

  sendJson(res, 200, {
    ok: true,
    imageBase64,
    imageUrl
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
        baseUrl: OPENAI_BASE_URL,
        imageModel: IMAGE_MODEL
      })
      return
    }

    if (req.method === "POST" && req.url === "/api/generate-image") {
      await handleGenerateImage(req, res)
      return
    }

    sendJson(res, 404, {
      ok: false,
      error: "Route not found."
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
