const assert = require("assert")
const { execFileSync } = require("child_process")

process.env.NODE_ENV = "test"
process.env.IMAGE_PROVIDER = "volcengine"
process.env.ARK_API_KEY = "ark-test-key"
process.env.IMAGE_MODEL = "seedream-4-0-250828"
process.env.IMAGE_EDIT_MODEL = "seededit-3-0-i2i-250628"

const {
  buildImageApiRequest,
  getHealthInfo,
  getImageFromResult
} = require("../server")

const referenceImage = "data:image/jpeg;base64,abc123"
const request = buildImageApiRequest({
  prompt: "生成健身房装修效果图",
  size: "2048x2048",
  referenceImagesBase64: [referenceImage]
})

assert.strictEqual(request.options.hostname, "ark.cn-beijing.volces.com")
assert.strictEqual(request.options.path, "/api/v3/images/generations")
assert.strictEqual(request.options.headers.Authorization, "Bearer ark-test-key")
assert.strictEqual(request.body.model, "seededit-3-0-i2i-250628")
assert.strictEqual(request.body.prompt, "生成健身房装修效果图")
assert.strictEqual(request.body.image, referenceImage)
assert.strictEqual(request.body.size, "2048x2048")
assert.strictEqual(request.body.n, 1)
assert.ok(!("image2" in request.body), "volcengine first pass should send the primary reference image only")

const health = getHealthInfo()
assert.strictEqual(health.provider, "volcengine")
assert.strictEqual(health.hasApiKey, true)
assert.strictEqual(health.baseUrl, "https://ark.cn-beijing.volces.com/api/v3")
assert.strictEqual(health.imageEditModel, "seededit-3-0-i2i-250628")

assert.deepStrictEqual(getImageFromResult({
  data: [{ b64_json: "base64-image" }]
}), {
  imageBase64: "base64-image",
  imageUrl: ""
})

assert.deepStrictEqual(getImageFromResult({
  output: {
    choices: [
      {
        message: {
          content: [
            { type: "image", image: "https://example.com/result.png" }
          ]
        }
      }
    ]
  }
}), {
  imageBase64: "",
  imageUrl: "https://example.com/result.png"
})

const defaultModelHealth = JSON.parse(execFileSync(process.execPath, [
  "-e",
  "process.env.IMAGE_PROVIDER='volcengine';process.env.ARK_API_KEY='x';delete process.env.IMAGE_MODEL;delete process.env.IMAGE_EDIT_MODEL;const {getHealthInfo}=require('./server');console.log(JSON.stringify(getHealthInfo()))"
], {
  cwd: __dirname + "/..",
  encoding: "utf8"
}))

assert.strictEqual(defaultModelHealth.imageModel, "seedream-4-0-250828")
assert.strictEqual(defaultModelHealth.imageEditModel, "seededit-3-0-i2i-250628")

console.log("server provider tests passed")
