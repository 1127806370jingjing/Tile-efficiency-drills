# 福州麻将练习器

一个面向新手的福州麻将弃牌牌效练习网页。第一版支持随机手牌、本局金牌、弃牌判断、牌效解释、本地练习记录和嵌入式 AI 教练。

## 本地开发

```bash
npm install
npm run dev
```

本地 Vite 预览只运行前端。如果没有启动 Cloudflare Pages Functions，AI 教练会自动使用本地规则解释作为降级反馈。

## Cloudflare Pages 部署

- Build command: `npm run build`
- Build output directory: `dist`
- Functions directory: `functions`

上线后在 Cloudflare Pages 项目里添加环境变量：

- `OPENAI_API_KEY`: OpenAI API Key，必须设置为 Secret
- `OPENAI_MODEL`: 可选，默认 `gpt-4.1-mini`
- `OPENAI_MAX_OUTPUT_TOKENS`: 可选，默认 `500`

AI 教练接口为：

```text
POST /api/coach
```

前端会把当前手牌、本局金牌、推荐弃牌、用户选择和问题发给这个接口。OpenAI API Key 只保存在 Cloudflare 后端环境变量中，不会暴露到浏览器。

每次 AI 回复会显示本次 token 用量，包括输入、输出和总 token。你也可以在 OpenAI 后台按指定 API Key 查看总体消耗。

## 访问保护

公网部署后建议在 Cloudflare Zero Trust 里给 Pages 域名加 Access 应用：

- 允许访问者：你的邮箱或指定邮箱列表
- 登录方式：One-time PIN
- Session duration：建议 30 days

这样同一台设备登录一次后，一段时间内不需要重复验证。
