# 政务智答 Vue 原型

基于 Vue 3 + Vite 的政务问答网页，后端通过 DeepSeek Chat API 生成回答。API Key 仅保存在服务端环境变量中，不会进入浏览器代码。

```bash
npm install
npm run build

# 配置服务端密钥（不要提交 .env）
export DEEPSEEK_API_KEY="你的 DeepSeek API Key"
npm run dev
```

打开 Vite 输出的本地网址即可使用。`npm run dev` 会同时启动 Vue 开发服务器和后端 API。

生产运行：

```bash
npm run build
DEEPSEEK_API_KEY="你的 DeepSeek API Key" npm start
```

可选环境变量：

- `DEEPSEEK_MODEL`：默认 `deepseek-v4-flash`
- `PORT`：后端端口，默认 `8787`

当前版本尚未接入权威政务知识库，因此所有回答仅供参考。
