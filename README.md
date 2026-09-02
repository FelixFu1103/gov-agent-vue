# 政务智答 Vue 原型

基于 Vue 3 + Vite 的政务问答网页，后端通过 DeepSeek Chat API 生成回答。API Key 仅保存在服务端环境变量中，不会进入浏览器代码。

```bash
npm install
npm run build

# 创建本地密钥文件（.env 已被 Git 忽略）
cp .env.example .env
# 然后打开 .env，把占位内容替换成你的 DeepSeek API Key
npm run dev
```

打开 Vite 输出的本地网址即可使用。`npm run dev` 会同时启动 Vue 开发服务器和后端 API。

生产运行：

```bash
npm run build
npm start
```

可选环境变量：

- `DEEPSEEK_MODEL`：默认 `deepseek-v4-flash`
- `PORT`：后端端口，默认 `8787`

当前版本已接入首批官方门户事项索引资料，但尚未收录每个事项的完整办事指南，因此所有回答仍仅供参考。

## 江苏政务知识库

`knowledge/documents/` 中包含首批 30 份江苏政务事项索引资料。后端会在每次提问时执行本地检索，将最相关的最多 4 份资料连同官方来源传给 DeepSeek。当前资料用于确认事项入口和主管部门，不代替具体办事指南；涉及条件、材料、费用和时限时仍须进入来源页面核验。
