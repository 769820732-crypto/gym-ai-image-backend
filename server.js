const http = require("http")
const https = require("https")
const crypto = require("crypto")

const PORT = Number(process.env.PORT || 8787)
const IMAGE_PROVIDER = normalizeImageProvider(process.env.IMAGE_PROVIDER)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const ARK_API_KEY = process.env.ARK_API_KEY
const ALIYUN_API_KEY = process.env.ALIYUN_API_KEY
const BACKEND_ACCESS_TOKEN = String(process.env.BACKEND_ACCESS_TOKEN || "").trim()
const IMAGE_API_KEY = getProviderApiKey()
const MEMBER_ANALYSIS_PROVIDER = normalizeMemberAnalysisProvider(process.env.MEMBER_ANALYSIS_PROVIDER)
const MEMBER_ANALYSIS_API_KEY = getMemberAnalysisApiKey()
const RAW_OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || getDefaultBaseUrl(IMAGE_PROVIDER)
const OPENAI_BASE_URL = normalizeProviderBaseUrl(RAW_OPENAI_BASE_URL)
const RAW_IMAGE_MODEL = process.env.IMAGE_MODEL || getDefaultImageModel(IMAGE_PROVIDER)
const IMAGE_MODEL = normalizeImageModel(RAW_IMAGE_MODEL)
const RAW_IMAGE_EDIT_MODEL = process.env.IMAGE_EDIT_MODEL || getDefaultImageEditModel(IMAGE_PROVIDER)
const IMAGE_EDIT_MODEL = normalizeImageModel(RAW_IMAGE_EDIT_MODEL)
const RAW_VISION_MODEL = process.env.VISION_MODEL || getDefaultVisionModel(IMAGE_PROVIDER)
const VISION_MODEL = normalizeVisionModel(RAW_VISION_MODEL)
const RAW_MEMBER_ANALYSIS_MODEL = process.env.MEMBER_ANALYSIS_MODEL || getDefaultMemberAnalysisModel(MEMBER_ANALYSIS_PROVIDER)
const MEMBER_ANALYSIS_MODEL = normalizeMemberAnalysisModel(RAW_MEMBER_ANALYSIS_MODEL)
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

function normalizeMemberAnalysisProvider(provider) {
  const normalizedProvider = String(provider || IMAGE_PROVIDER || "openai-compatible").trim().toLowerCase()
  if (["aliyun", "bailian", "dashscope"].includes(normalizedProvider)) {
    return "aliyun"
  }
  return normalizeImageProvider(normalizedProvider)
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

function getDefaultVisionModel(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return "doubao-1-5-vision-pro-32k"
  }
  return "gpt-4o-mini"
}

function getDefaultMemberAnalysisModel(provider = MEMBER_ANALYSIS_PROVIDER) {
  if (provider === "aliyun") {
    return "qwen3.6-plus"
  }
  return getDefaultVisionModel(provider)
}

function getProviderApiKey(provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return ARK_API_KEY || OPENAI_API_KEY
  }
  return OPENAI_API_KEY
}

function getMemberAnalysisApiKey(provider = MEMBER_ANALYSIS_PROVIDER) {
  if (provider === "aliyun") {
    return ALIYUN_API_KEY
  }
  return getProviderApiKey(provider)
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

function normalizeVisionModel(model) {
  return String(model || "").trim() || getDefaultVisionModel()
}

function normalizeMemberAnalysisModel(model) {
  return String(model || "").trim() || getDefaultMemberAnalysisModel()
}

function getMemberAnalysisBaseUrl() {
  if (MEMBER_ANALYSIS_PROVIDER === "aliyun") {
    return {
      hostname: "dashscope.aliyuncs.com",
      port: 443,
      pathname: "/compatible-mode"
    }
  }
  return normalizeBaseUrl()
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Backend-Token"
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

function resolveVolcengineImageSize(size, hasReferenceImage) {
  if (!hasReferenceImage) return size || "1024x1024"
  if (!size || size === "1024x1024") return "2K"
  return size
}

function buildVolcengineRequestBody({ prompt, size, referenceImages }) {
  const hasReferenceImage = Boolean(referenceImages.length)
  const imageSize = resolveVolcengineImageSize(size, hasReferenceImage)
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

function getChatCompletionsApiPath(baseUrl, provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return `${baseUrl.pathname}/chat/completions`
  }
  return `${baseUrl.pathname}/v1/chat/completions`
}

function getResponsesApiPath(baseUrl, provider = IMAGE_PROVIDER) {
  if (provider === "volcengine") {
    return `${baseUrl.pathname}/responses`
  }
  return `${baseUrl.pathname}/v1/responses`
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

function buildMemberAnalysisPrompt(memberName) {
  const memberText = memberName ? `会员姓名：${memberName}\n` : ""
  return `${memberText}请分析上传的健身/普拉提会员体测报告、围度截图、体态分析图或体态照片。

任务：
1. 尽量识别体脂率变化、体重变化、体态变化。
2. 如果图片里只有单次数据，请用“当前为...”描述，不要编造上次数据。
3. 如果看不清或图片没有对应信息，对应字段返回空字符串。
4. 只返回 JSON，不要返回 Markdown。

JSON 字段：
{
  "bodyFatChange": "体脂率变化结论",
  "weightChange": "体重变化结论",
  "postureChange": "体态变化结论",
  "analysisSummary": "给教练看的简短分析摘要，50字以内"
}`
}

function buildMemberImageAnalysisApiRequest({ imagesBase64, memberName }) {
  const baseUrl = getMemberAnalysisBaseUrl()
  const images = normalizeReferenceImages(imagesBase64)
  const body = MEMBER_ANALYSIS_PROVIDER === "volcengine"
    ? {
      model: MEMBER_ANALYSIS_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildMemberAnalysisPrompt(memberName)
            },
            ...images.map(image => ({
              type: "input_image",
              image_url: image
            }))
          ]
        }
      ],
      temperature: 0.2
    }
    : {
      model: MEMBER_ANALYSIS_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildMemberAnalysisPrompt(memberName)
            },
            ...images.map(image => ({
              type: "image_url",
              image_url: {
                url: image
              }
            }))
          ]
        }
      ],
      temperature: 0.2
    }
  const payload = JSON.stringify(body)
  const options = {
    hostname: baseUrl.hostname,
    port: baseUrl.port,
    path: MEMBER_ANALYSIS_PROVIDER === "volcengine" ? getResponsesApiPath(baseUrl, MEMBER_ANALYSIS_PROVIDER) : getChatCompletionsApiPath(baseUrl, MEMBER_ANALYSIS_PROVIDER),
    method: "POST",
    headers: {
      Authorization: `Bearer ${MEMBER_ANALYSIS_API_KEY}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload)
    },
    timeout: 120000
  }

  return { body, payload, options }
}

function callMemberImageAnalysisApi({ imagesBase64, memberName }) {
  const { payload, options } = buildMemberImageAnalysisApiRequest({ imagesBase64, memberName })

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
          reject(new Error(`Vision API returned invalid JSON: ${body.slice(0, 300)}`))
          return
        }

        if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
          const message =
            (json.error && json.error.message) ||
            json.message ||
            json.msg ||
            JSON.stringify(json).slice(0, 300)
          reject(new Error(`Vision API request failed: ${apiRes.statusCode} ${message}`))
          return
        }

        resolve(json)
      })
    })

    req.on("timeout", () => {
      req.destroy(new Error("Vision API request timed out."))
    })
    req.on("error", reject)
    req.write(payload)
    req.end()
  })
}

function extractJsonObject(text) {
  const rawText = String(text || "").trim()
  if (!rawText) return {}
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1].trim() : rawText
  try {
    return JSON.parse(candidate)
  } catch (error) {
    const start = candidate.indexOf("{")
    const end = candidate.lastIndexOf("}")
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1))
    }
    throw error
  }
}

function normalizeAnalysisText(value) {
  return String(value || "").trim().slice(0, 200)
}

function extractMemberImageAnalysis(result) {
  const firstChoice = result.choices && result.choices[0] ? result.choices[0] : {}
  const message = firstChoice.message || {}
  const responseOutputText = Array.isArray(result.output)
    ? result.output
      .flatMap(item => Array.isArray(item.content) ? item.content : [])
      .map(item => item && (item.text || item.content || ""))
      .join("")
    : ""
  const content = responseOutputText || (Array.isArray(message.content)
    ? message.content.map(item => item && (item.text || item.content || "")).join("")
    : message.content)
  const parsed = extractJsonObject(content)

  return {
    bodyFatChange: normalizeAnalysisText(parsed.bodyFatChange),
    weightChange: normalizeAnalysisText(parsed.weightChange),
    postureChange: normalizeAnalysisText(parsed.postureChange),
    analysisSummary: normalizeAnalysisText(parsed.analysisSummary)
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

  if (!MEMBER_ANALYSIS_API_KEY) {
    sendJson(res, 500, {
      ok: false,
      error: MEMBER_ANALYSIS_PROVIDER === "aliyun"
        ? "Server missing ALIYUN_API_KEY."
        : (MEMBER_ANALYSIS_PROVIDER === "volcengine" ? "Server missing ARK_API_KEY." : "Server missing OPENAI_API_KEY.")
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

async function handleAnalyzeMemberImages(req, res) {
  if (!isGenerateRequestAuthorized(req)) {
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized image analysis request."
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
  const imagesBase64 = normalizeReferenceImages(body.imagesBase64 || body.referenceImagesBase64 || [])
  const memberName = String(body.memberName || "").trim()

  if (!imagesBase64.length) {
    sendJson(res, 400, {
      ok: false,
      error: "Missing analysis images."
    })
    return
  }

  const result = await callMemberImageAnalysisApi({ imagesBase64, memberName })
  sendJson(res, 200, {
    ok: true,
    analysis: extractMemberImageAnalysis(result)
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
    visionModel: VISION_MODEL,
    memberAnalysisProvider: MEMBER_ANALYSIS_PROVIDER,
    memberAnalysisModel: MEMBER_ANALYSIS_MODEL,
    hasMemberAnalysisApiKey: Boolean(MEMBER_ANALYSIS_API_KEY),
    hasBackendAccessToken: Boolean(BACKEND_ACCESS_TOKEN),
    configuredBaseUrl: RAW_OPENAI_BASE_URL,
    configuredImageModel: RAW_IMAGE_MODEL,
    configuredImageEditModel: RAW_IMAGE_EDIT_MODEL,
    configuredVisionModel: RAW_VISION_MODEL,
    configuredMemberAnalysisModel: RAW_MEMBER_ANALYSIS_MODEL
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

    if (req.method === "POST" && requestPath === "/api/analyze-member-images") {
      await handleAnalyzeMemberImages(req, res)
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
  buildMemberImageAnalysisApiRequest,
  extractMemberImageAnalysis,
  buildImageApiRequest,
  getHealthInfo,
  getImageFromResult,
  isGenerateRequestAuthorized,
  normalizeReferenceImages,
  server
}
