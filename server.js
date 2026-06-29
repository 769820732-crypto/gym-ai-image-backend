const http = require("http")
const https = require("https")
const crypto = require("crypto")

const PORT = Number(process.env.PORT || 8787)
const IMAGE_PROVIDER = normalizeImageProvider(process.env.IMAGE_PROVIDER)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const ARK_API_KEY = process.env.ARK_API_KEY
const BACKEND_ACCESS_TOKEN = String(process.env.BACKEND_ACCESS_TOKEN || "").trim()
const IMAGE_API_KEY = getProviderApiKey()
const RAW_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || getDefaultBaseUrl(IMAGE_PROVIDER)
const OPENAI_BASE_URL = normalizeProviderBaseUrl(RAW_OPENAI_BASE_URL)
const RAW_IMAGE_MODEL = process.env.IMAGE_MODEL || getDefaultImageModel(IMAGE_PROVIDER)
const IMAGE_MODEL = normalizeImageModel(RAW_IMAGE_MODEL)
const RAW_IMAGE_EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || getDefaultImageEditModel(IMAGE_PROVIDER)
const IMAGE_EDIT_MODEL = normalizeImageModel(RAW_IMAGE_EDIT_MODEL)
const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES || 20 * 1024 * 1024)
const NEGATIVE_PROMPT = process.env.NEGATIVE_PROMPT ||
  "low quality, cheap poster, amateur phone photo, ordinary group class, centered frontal portrait, direct eye contact, cluttered background, messy room, ugly lighting, harsh shadows, text, watermark, logo, QR code, phone number, readable words, cartoon, illustration, plastic skin, distorted hands, distorted feet, blurry face, bad anatomy, vulgar exposure, exaggerated muscles"

function normalizeImageProvider(provider) {
  const normalizedProvider = String(provider || "openai-compatible").trim().toLowerCase()
  if (["volcengine", "ark", "doubao"].includes(normalizedProvider)) {
    return "volcengine"
  }
  return "openai-compatible"
}

function getDefaultBaseUrl(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return "https://ark.cn-beijing.volces.com/api/v3"
  }
  return "https://api.siliconflow.cn"
}

function getDefaultImageModel(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return "doubao-seedream-4-0-250828"
  }
  return "Qwen/Qwen-Image"
}

function getDefaultImageEditModel(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return "doubao-seedream-4-0-250828"
  }
  return "Qwen/Qwen-Image-Edit-2509"
}

function getProviderApiKey(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return ARK_API_KEY || OPENAI_API_KEY
  }
  return OPENAI_API_KEY
}

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

function safeTokenEquals(actualToken, expectedToken) {
  const actual = Buffer.from(String(actualToken || ""))
  const expected = Buffer.from(String(expectedToken || ""))
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function extractRequestToken(req) {
  const headers = req && req.headers ? req.headers : {}
  const explicitToken = headers["x-backend-token"]
  const authorization = String(headers.authorization || "")

  if (explicitToken) return String(explicitToken)
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim()
  }
  return ""
}

function isGenerateRequestAuthorized(req) {
  if (!BACKEND_ACCESS_TOKEN) return true
  return safeTokenEquals(extractRequestToken(req), BACKEND_ACCESS_TOKEN)
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

function normalizeReferenceImages(images) {
  return (Array.isArray(images) ? images : [images])
    .map(normalizeReferenceImage)
    .filter(Boolean)
    .slice(0, 3)
}

function buildReferenceImageFields(referenceImages) {
  const fields = {}
  if (referenceImages[0]) fields.image = referenceImages[0]
  if (referenceImages[1]) fields.image2 = referenceImages[1]
  if (referenceImages[2]) fields.image3 = referenceImages[2]
  return fields
}

function buildOpenAICompatibleRequestBody({ prompt, size, referenceImages }) {
  const imageSize = size || "1024x1024"
  const referenceImageFields = buildReferenceImageFields(referenceImages)
  const hasReferenceImage = Boolean(referenceImages.length)

  return OPENAI_BASE_URL.includes("api.siliconflow.cn")
    ? hasReferenceImage
      ? {
      model: IMAGE_EDIT_MODEL,
      prompt,
      ...referenceImageFields
    }
      : {
      model: IMAGE_MODEL,
      prompt,
      image_size: imageSize
    }
    : {
    model: hasReferenceImage ? IMAGE_EDIT_MODEL : IMAGE_MODEL,
    prompt,
    ...referenceImageFields,
    negative_prompt: NEGATIVE_PROMPT,
    image_size: imageSize,
    batch_size: 1,
    num_inference_steps: 28,
    guidance_scale: 8,
    size: imageSize,
    quality: "low",
    n: 1
  }
}

function buildVolcengineRequestBody({ prompt, size, referenceImages }) {
  const imageSize = size || "1024x1024"
  const hasReferenceImage = Boolean(referenceImages.length)
  const body = {
    model: hasReferenceImage ? IMAGE_EDIT_MODEL : IMAGE_MODEL,
    prompt,
    size: imageSize,
    n: 1,
    watermark: false
  }

  if (hasReferenceImage) {
    body.image = referenceImages
  }

  return body
}

function getImageApiPath(baseUrl, provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return `${baseUrl.pathname}/images/generations`
  }
  return `${baseUrl.pathname}/v1/images/generations`
}

function buildImageApiRequest({ prompt, size, referenceImageBase64, referenceImagesBase64 }) {
  const baseUrl = normalizeBaseUrl()
  const referenceImages = normalizeReferenceImages(
    referenceImagesBase64 && referenceImagesBase64.length ? referenceImagesBase64 : referenceImageBase64
  )
  const body = IMAGE_PROVIDER === "volcengine"
    ? buildVolcengineRequestBody({ prompt, size, referenceImages })
    : buildOpenAICompatibleRequestBody({ prompt, size, referenceImages })
  const payload = JSON.stringify(body)

  const options = {
    hostname: baseUrl.hostname,
    port: baseUrl.port,
    path: getImageApiPath(baseUrl),
    method: "POST",
    headers: {
      Authorization: `Bearer ${IMAGE_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
    timeout: 180000
  }

  return { body, payload, options }
}

function callImageApi({ prompt, size, referenceImageBase64, referenceImagesBase64 }) {
  const { payload, options } = buildImageApiRequest({
    prompt,
    size,
    referenceImageBase64,
    referenceImagesBase64
  })

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
  const firstChoice = result.output && result.output.choices && result.output.choices[0]
    ? result.output.choices[0]
    : {}
  const firstContentImage = firstChoice.message && Array.isArray(firstChoice.message.content)
    ? firstChoice.message.content.find(item => item && item.type === "image" && item.image)
    : null

  return {
    imageBase64: firstData.b64_json || firstImage.b64_json || "",
    imageUrl: firstData.url || firstImage.url || (firstContentImage ? firstContentImage.image : "")
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
  if (!isGenerateRequestAuthorized(req)) {
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized image generation request."
    })
    return
  }

  if (!IMAGE_API_KEY) {
    sendJson(res, 500, {
      ok: false,
      error: IMAGE_PROVIDER === "volcengine" ? "Server missing ARK_API_KEY." : "Server missing OPENAI_API_KEY."
    })
    return
  }

  const body = await readJson(req)
  const prompt = String(body.prompt || "").trim()
  const size = String(body.size || "1024x1024")
  const referenceImageBase64 = String(body.referenceImageBase64 || body.inputImageBase64 || "").trim()
  const referenceImagesBase64 = Array.isArray(body.referenceImagesBase64)
    ? body.referenceImagesBase64
    : []

  if (!prompt) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing prompt."
    })
    return
  }

  const result = await callImageApi({ prompt, size, referenceImageBase64, referenceImagesBase64 })
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

function getHealthInfo() {
  return {
    ok: true,
    service: "gym-ai-image-backend",
    provider: IMAGE_PROVIDER,
    hasApiKey: Boolean(IMAGE_API_KEY),
    baseUrl: OPENAI_BASE_URL,
    imageModel: IMAGE_MODEL,
    imageEditModel: IMAGE_EDIT_MODEL,
    hasBackendAccessToken: Boolean(BACKEND_ACCESS_TOKEN),
    configuredBaseUrl: RAW_OPENAI_BASE_URL,
    configuredImageModel: RAW_IMAGE_MODEL,
    configuredImageEditModel: RAW_IMAGE_EDIT_MODEL
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname

    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === "GET" && (requestPath === "/" || requestPath === "/health")) {
      sendJson(res, 200, getHealthInfo())
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

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Image backend listening on http://localhost:${PORT}`)
  })
}

module.exports = {
  buildImageApiRequest,
  getHealthInfo,
  getImageFromResult,
  isGenerateRequestAuthorized,
  normalizeReferenceImages,
  server
}
