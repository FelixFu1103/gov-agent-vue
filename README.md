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

- `DEEPSEEK_MODEL`：默认 `deepseek-chat`
- `PORT`：后端端口，默认 `8787`

当前版本已接入首批官方门户事项索引资料，但尚未收录每个事项的完整办事指南，因此所有回答仍仅供参考。

## 江苏政务知识库

`knowledge/documents/` 中包含 32 份江苏政务资料。后端会在每次提问时执行本地检索，将当前最相关的主资料连同官方来源传给 DeepSeek，避免低相关资料污染回答。

医保已完成首批 5 项纵向闭环：职工医保参保、居民医保参保、异地就医备案、门诊/住院零星报销、生育医疗费支付。这 5 项包含适用对象、材料、渠道、流程、时限、回答边界和江苏省医保局原始依据；其他主题目前仍以事项索引为主。

运行 `npm test` 可执行医保检索回归测试。

## 医保 Agent 工具循环

每次聊天请求会按顺序执行 8 个可测试工具：

1. `classify_intent`：识别当前 5 类医保意图，并在省略主语的后续轮次延续已有意图。
2. `extract_slots`：从当前消息和历史中提取参保城市、就医城市、参保险种、人员类型和办理阶段。
3. `update_session_state`：使用前端生成的 `conversationId` 在服务端合并会话状态；原型状态保留 30 分钟。
4. `check_required_slots`：按事项检查必要字段，并且每次只生成一个最优先的追问。
5. `search_policy`：查询本地政策知识并返回来源、版本和核验日期。
6. `get_service_guide`：按照标准事项编码取得完整办事指南。
7. `assess_evidence`：检查指南是否存在、是否超过一年未核验以及个性化信息是否完整。
8. `generate_material_checklist`：根据意图和人员类别生成材料清单。

`POST /api/chat` 的响应中包含 `agent` 调试字段，可查看意图、置信度、已收集槽位、缺失槽位、证据判断和本轮工具轨迹。`GET /api/health` 会返回已注册工具名称。

当前会话状态使用进程内存，适合单机原型；生产环境应替换为 Redis 或数据库，以支持多实例、持久化、加密和过期治理。

## PostgreSQL + pgvector 知识库

项目支持数据库优先、本地 Markdown 自动降级。数据库保存文档版本、来源、核验日期、正文分块和 1536 维向量，并使用 `pg_trgm` 中文相似度与向量余弦相似度进行混合排序。

安装 Docker Desktop 后运行：

```bash
npm run db:start
npm run db:model
npm run db:ingest
npm run dev
```

检查 `GET /api/health`：

```json
{
  "database": {
    "connected": true,
    "documents": 32,
    "vectorEnabled": true,
    "vectorizedChunks": 32
  }
}
```

默认通过 Docker 中的 Ollama 和 `bge-m3` 在本机生成1024维向量，知识正文不会发送给第三方。首次使用需要运行 `npm run db:model` 下载模型，然后运行 `npm run db:ingest`。

如需改用云端 OpenAI 兼容的 Embedding 服务，可在 `.env` 修改：

```dotenv
EMBEDDING_API_URL=https://your-provider.example/v1/embeddings
EMBEDDING_API_KEY=your_key
EMBEDDING_MODEL=your_1536_dimension_model
EMBEDDING_DIMENSIONS=1536
```

然后再次执行 `npm run db:ingest` 生成并写入向量。`EMBEDDING_DIMENSIONS` 必须与模型实际输出一致；DeepSeek Chat Key 只用于生成回答，不能直接替代 Embedding 服务。

数据库不可用或没有导入数据时，Agent 会继续使用 `knowledge/documents/`，并在服务端日志和健康检查中标明降级状态。
