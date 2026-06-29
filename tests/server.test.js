const assert = require("assert")
const { execFileSync } = require("child_process")

process.env.NODE_ENV = "test"
process.env.IMAGE_PROVIDER = "volcengine"
process.env.ARK_API_KEY = "ark-test-key"
process.env.IMAGE_MODEL = "doubao-seedream-4-0-250828"
process.env.IMAGE_EDIT_MODEL = "doubao-seedream-4-0-250828"

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
assert.strictEqual(request.body.model, "doubao-seedream-4-0-250828")
assert.strictEqual(request.body.prompt, "生成健身房装修效果图")
assert.strictEqual(request.body.image, referenceImage)
assert.strictEqual(request.body.size, "2048x2048")
assert.strictEqual(request.body.n, 1)
assert.strictEqual(request.body.watermark, false)
assert.ok(!("image2" in request.body), "volcengine first pass should send the primary reference image only")

const health = getHealthInfo()
assert.strictEqual(health.provider, "volcengine")
assert.strictEqual(health.hasApiKey, true)
assert.strictEqual(health.baseUrl, "https://ark.cn-beijing.volces.com/api/v3")
assert.strictEqual(health.imageEditModel, "doubao-seedream-4-0-250828")

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

assert.strictEqual(defaultModelHealth.imageModel, "doubao-seedream-4-0-250828")
assert.strictEqual(defaultModelHealth.imageEditModel, "doubao-seedream-4-0-250828")

const accessTokenChecks = JSON.parse(execFileSync(process.execPath, [
  "-e",
  "process.env.BACKEND_ACCESS_TOKEN='server-secret';" +
    "const {getHealthInfo,isGenerateRequestAuthorized}=require('./server');" +
    "const checks={" +
    "missing:isGenerateRequestAuthorized({headers:{}})," +
    "wrong:isGenerateRequestAuthorized({headers:{authorization:'Bearer wrong'}})," +
    "bearer:isGenerateRequestAuthorized({headers:{authorization:'Bearer server-secret'}})," +
    "header:isGenerateRequestAuthorized({headers:{'x-backend-token':'server-secret'}})," +
    "health:getHealthInfo()" +
    "};" +
    "console.log(JSON.stringify(checks))"
], {
  cwd: __dirname + "/..",
  encoding: "utf8"
}))

assert.strictEqual(accessTokenChecks.missing, false)
assert.strictEqual(accessTokenChecks.wrong, false)
assert.strictEqual(accessTokenChecks.bearer, true)
assert.strictEqual(accessTokenChecks.header, true)
assert.strictEqual(accessTokenChecks.health.hasBackendAccessToken, true)
assert.ok(!JSON.stringify(accessTokenChecks.health).includes("server-secret"))

console.log("server provider tests passed")
