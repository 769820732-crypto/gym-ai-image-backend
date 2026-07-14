const assert = require("assert")
const { execFileSync } = require("child_process")

process.env.NODE_ENV = "test"
process.env.IMAGE_PROVIDER = "volcengine"
process.env.ARK_API_KEY = "ark-test-key"
process.env.IMAGE_MODEL = "doubao-seedream-4-0-250828"
process.env.IMAGE_EDIT_MODEL = "doubao-seedream-4-0-250828"

const {
  buildMemberImageAnalysisApiRequest,
  extractMemberImageAnalysis,
  buildImageApiRequest,
  getHealthInfo,
  getImageFromResult
} = require("../server")

const referenceImage = "data:image/jpeg;base64,abc123"
const secondReferenceImage = "data:image/jpeg;base64,def456"
const request = buildImageApiRequest({
  prompt: "生成健身房装修效果图",
  size: "2048x2048",
  referenceImagesBase64: [referenceImage, secondReferenceImage]
})

assert.strictEqual(request.options.hostname, "ark.cn-beijing.volces.com")
assert.strictEqual(request.options.path, "/api/v3/images/generations")
assert.strictEqual(request.options.headers.Authorization, "Bearer ark-test-key")
assert.strictEqual(request.body.model, "doubao-seedream-4-0-250828")
assert.strictEqual(request.body.prompt, "生成健身房装修效果图")
assert.deepStrictEqual(request.body.image, [referenceImage, secondReferenceImage])
assert.strictEqual(request.body.size, "2048x2048")
assert.strictEqual(request.body.n, 1)
assert.strictEqual(request.body.watermark, false)
assert.ok(!("image2" in request.body), "volcengine first pass should send the primary reference image only")

const legacySquareRequest = buildImageApiRequest({
  prompt: "鐢熸垚鍋ヨ韩鎴胯淇晥鏋滃浘",
  size: "1024x1024",
  referenceImagesBase64: [referenceImage]
})

assert.strictEqual(
  legacySquareRequest.body.size,
  "2K",
  "volcengine image-to-image requests should not force square output because it changes the room layout"
)

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

const analysisRequest = buildMemberImageAnalysisApiRequest({
  imagesBase64: [referenceImage, secondReferenceImage],
  memberName: "member-a"
})

assert.strictEqual(analysisRequest.options.hostname, "ark.cn-beijing.volces.com")
assert.strictEqual(analysisRequest.options.path, "/api/v3/responses")
assert.strictEqual(analysisRequest.options.headers.Authorization, "Bearer ark-test-key")
assert.ok(analysisRequest.body.input[0].content.some(item => item.type === "input_text"), "analysis request should include text instructions")
assert.strictEqual(
  analysisRequest.body.input[0].content.filter(item => item.type === "input_image").length,
  2,
  "analysis request should include up to three uploaded images"
)
assert.ok(
  analysisRequest.body.input[0].content[0].text.includes("bodyFatChange"),
  "analysis prompt should request body data fields"
)

assert.deepStrictEqual(extractMemberImageAnalysis({
  choices: [
    {
      message: {
        content: JSON.stringify({
          bodyFatChange: "body-fat-down",
          weightChange: "weight-down",
          postureChange: "posture-up",
          analysisSummary: "summary"
        })
      }
    }
  ]
}), {
  bodyFatChange: "body-fat-down",
  weightChange: "weight-down",
  postureChange: "posture-up",
  analysisSummary: "summary"
})

assert.deepStrictEqual(extractMemberImageAnalysis({
  output: [
    {
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            bodyFatChange: "response-body-fat",
            weightChange: "response-weight",
            postureChange: "response-posture",
            analysisSummary: "response-summary"
          })
        }
      ]
    }
  ]
}), {
  bodyFatChange: "response-body-fat",
  weightChange: "response-weight",
  postureChange: "response-posture",
  analysisSummary: "response-summary"
})

const aliyunAnalysisRequest = JSON.parse(execFileSync(process.execPath, [
  "-e",
  "process.env.IMAGE_PROVIDER='volcengine';" +
    "process.env.ARK_API_KEY='ark-test-key';" +
    "process.env.MEMBER_ANALYSIS_PROVIDER='aliyun';" +
    "process.env.ALIYUN_API_KEY='aliyun-test-key';" +
    "process.env.MEMBER_ANALYSIS_MODEL='qwen3.6-plus';" +
    "const {buildMemberImageAnalysisApiRequest,getHealthInfo}=require('./server');" +
    "const request=buildMemberImageAnalysisApiRequest({imagesBase64:['data:image/jpeg;base64,abc123'],memberName:'member-a'});" +
    "console.log(JSON.stringify({request,health:getHealthInfo()}));"
], {
  cwd: __dirname + "/..",
  encoding: "utf8"
}))

assert.strictEqual(aliyunAnalysisRequest.request.options.hostname, "dashscope.aliyuncs.com")
assert.strictEqual(aliyunAnalysisRequest.request.options.path, "/compatible-mode/v1/chat/completions")
assert.strictEqual(aliyunAnalysisRequest.request.options.headers.Authorization, "Bearer aliyun-test-key")
assert.strictEqual(aliyunAnalysisRequest.request.body.model, "qwen3.6-plus")
assert.ok(aliyunAnalysisRequest.request.body.messages[0].content.some(item => item.type === "text"))
assert.strictEqual(
  aliyunAnalysisRequest.request.body.messages[0].content.filter(item => item.type === "image_url").length,
  1,
  "aliyun analysis request should send uploaded image as image_url content"
)
assert.strictEqual(aliyunAnalysisRequest.health.memberAnalysisProvider, "aliyun")
assert.strictEqual(aliyunAnalysisRequest.health.memberAnalysisModel, "qwen3.6-plus")
assert.ok(!JSON.stringify(aliyunAnalysisRequest.health).includes("aliyun-test-key"))

console.log("server provider tests passed")
