const http = require("http")
const https = require("https")

const PORT = Number(process.env.PORT || 8787)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const RAW_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn"
const OPENAI_BASE_URL = normalizeProviderBaseUrl(RAW_OPENAI_BASE_URL)
const RAW_IMAGE_MODEL = process.env.IMAGE_MODEL || "Qwen/Qwen-Image"
const IMAGE_MODEL = normalizeImageModel(RAW_IMAGE_MODEL)
const RAW_IMAGE_EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || "Qwen/Qwen-Image-Edit-2509"
const IMAGE_EDIT_MODEL = normalizeImageModel(RAW_IMAGE_EDIT_MODEL)
const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES || 12 * 1024 * 1024)
const NEGATIVE_PROMPT = process.env.NEGATIVE_PROMPT ||
  "low quality, cheap poster, amateur phone photo, ordinary group class, centered frontal portrait, direct eye contact, cluttered background, messy room, ugly lighting, harsh shadows, text, watermark, logo, QR code, phone number, readable words, cartoon, illustration, plastic skin, distorted hands, distorted feet, blurry face, bad anatomy, vulgar exposure, exaggerated muscles"

function normalizeProviderBaseUrl(baseUrl) {
  const trimmedUrl = String(baseUrl || "").replace(/\/$/, "")
  if (trimmedUrl === "https://api.siliconflow.com") {
    return "https://api.siliconflow.cn"
  }
  return trimmedUrl
}

function normalizeImageModel(model) {
  const trimmedModel = String(model || "").trim()
  if (
    OPENAI_BASE_URL.includes("api.siliconflow.cn") &&
    trimmedModel.startsWith("black-forest-labs/FLUX.1-Kontext")
  ) {
    return "Qwen/Qwen-Image"
  }
  return trimmedModel || "Qwen/Qwen-Image"
}

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
      if (body.length > MAX_REQUEST_BYTES) {
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

function normalizeReferenceImage(imageBase64) {
  const trimmedImage = String(imageBase64 || "").trim()
  if (!trimmedImage) return ""
  if (trimmedImage.startsWith("data:image/")) return trimmedImage
  return `data:image/jpeg;base64,${trimmedImage}`
}

function callImageApi({ prompt, size, referenceImageBase64 }) {
  const baseUrl = normalizeBaseUrl()
  const imageSize = size || "1024x1024"
  const referenceImage = normalizeReferenceImage(referenceImageBase64)
  const requestBody = OPENAI_BASE_URL.includes("api.siliconflow.cn")
    ? referenceImage
      ? {
      model: IMAGE_EDIT_MODEL,
      prompt,
      image: normalizeReferenceImage(referenceImageBase64)
    }
      : {
      model: IMAGE_MODEL,
      prompt,
      image_size: imageSize
    }
    : {
    model: referenceImage ? IMAGE_EDIT_MODEL : IMAGE_MODEL,
    prompt,
    image: referenceImage || undefined,
    negative_prompt: NEGATIVE_PROMPT,
    image_size: imageSize,
    batch_size: 1,
    num_inference_steps: 28,
    guidance_scale: 8,
    size: imageSize,
    quality: "low",
    n: 1
  }
  const payload = JSON.stringify(requestBody)

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
          const message =
            (json.error && json.error.message) ||
            json.message ||
            json.msg ||
            JSON.stringify(json).slice(0, 300)
          reject(new Error(`Image API request failed: ${apiRes.statusCode} ${message}`))
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

function downloadImageAsBase64(imageUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(imageUrl)
    const client = url.protocol === "https:" ? https : http

    const req = client.get(url, { timeout: 120000 }, (imageRes) => {
      if (imageRes.statusCode < 200 || imageRes.statusCode >= 300) {
        reject(new Error(`Image download failed: ${imageRes.statusCode}`))
        imageRes.resume()
        return
      }

      const chunks = []
      let totalLength = 0

      imageRes.on("data", chunk => {
        totalLength += chunk.length
        if (totalLength > 15 * 1024 * 1024) {
          reject(new Error("Generated image is too large."))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      imageRes.on("end", () => {
        resolve(Buffer.concat(chunks).toString("base64"))
      })
    })

    req.on("timeout", () => {
      req.destroy(new Error("Image download timed out."))
    })
    req.on("error", reject)
  })
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
  const referenceImageBase64 = String(body.referenceImageBase64 || body.inputImageBase64 || "").trim()

  if (!prompt) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing prompt."
    })
    return
  }

  const result = await callImageApi({ prompt, size, referenceImageBase64 })
  const image = getImageFromResult(result)
  const imageBase64 = image.imageBase64 || (image.imageUrl ? await downloadImageAsBase64(image.imageUrl) : "")
  const imageUrl = image.imageUrl

  if (!imageBase64) {
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
    const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname

    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === "GET" && (requestPath === "/" || requestPath === "/health")) {
      sendJson(res, 200, {
        ok: true,
        service: "gym-ai-image-backend",
        hasApiKey: Boolean(OPENAI_API_KEY),
        baseUrl: OPENAI_BASE_URL,
        imageModel: IMAGE_MODEL,
        imageEditModel: IMAGE_EDIT_MODEL,
        configuredBaseUrl: RAW_OPENAI_BASE_URL,
        configuredImageModel: RAW_IMAGE_MODEL,
        configuredImageEditModel: RAW_IMAGE_EDIT_MODEL
      })
      return
    }

    if (req.method === "POST" && requestPath === "/api/generate-image") {
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
