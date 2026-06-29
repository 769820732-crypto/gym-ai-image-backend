# 健身场馆 AI 图片生成后端

这是给小程序使用的 Node.js 图片生成后端。

## 本地运行

先配置环境变量：

```powershell
$env:OPENAI_API_KEY="你的 OpenAI API Key"
```

## 火山方舟 / 豆包图像模型配置

如果要把装修效果图从硅基流动 Qwen 切到火山方舟 Seedream/SeedEdit，在 Railway 的 Variables 里配置：

```text
IMAGE_PROVIDER=volcengine
ARK_API_KEY=你的火山方舟 API Key
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
IMAGE_MODEL=seedream-4-0-250828
IMAGE_EDIT_MODEL=seededit-3-0-i2i-250628
```

说明：

- `IMAGE_PROVIDER=volcengine` 会让后端请求火山方舟 `/api/v3/images/generations`。
- `ARK_API_KEY` 只放在后端，不要放进小程序前端。
- `IMAGE_EDIT_MODEL` 用于用户上传门店图后的图生图/编辑链路。
- 如果火山控制台给你的模型 ID 不同，以控制台开通的正式模型 ID 为准。
- 不配置 `IMAGE_PROVIDER` 时，后端仍保持原来的 OpenAI 兼容模式，默认走硅基流动。

启动服务：

```powershell
npm start
```

健康检查：

```text
http://localhost:8787/health
```

生成图片接口：

```text
POST http://localhost:8787/api/generate-image
```

请求体：

```json
{
  "prompt": "Square 1:1 WeChat Moments fitness poster image, premium deep red style, clean professional gym.",
  "size": "1024x1024"
}
```

返回：

```json
{
  "ok": true,
  "imageBase64": "..."
}
```

## 部署建议

微信小程序不能直接请求普通 HTTP，本地测试除外。正式上线需要：

1. 部署到支持 HTTPS 的服务器。
2. 配置合法域名。
3. 在微信公众平台后台添加 request 合法域名。
4. 后端保存 OpenAI API Key，不要放在小程序前端。

可选平台：

- 腾讯云轻量服务器
- 腾讯云云托管
- 阿里云 ECS
- Render
- Railway
- Fly.io

## 小程序接入

后续把小程序里的云函数调用替换为：

```js
wx.request({
  url: "https://你的域名/api/generate-image",
  method: "POST",
  data: {
    prompt,
    size: "1024x1024"
  }
})
```
