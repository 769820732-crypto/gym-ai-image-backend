# 健身场馆 AI 图片生成后端

这是给小程序使用的 Node.js 图片生成后端。

## 本地运行

先配置环境变量：

```powershell
$env:OPENAI_API_KEY="你的 OpenAI API Key"
```

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

