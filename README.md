# 江苏医保 Agent

面向江苏省基本医疗保险业务的智能咨询 Agent。前端使用 Vue 3 + Vite，后端使用 Node.js；DeepSeek 负责依据证据组织回答，PostgreSQL + pgvector、Ollama + bge-m3 负责本地混合知识检索。

> 当前是学习与验证版本，不代表医保经办机构。政策和各市执行口径可能调整，最终以参保地医保部门最新规定为准。

## 当前覆盖范围

系统当前回答知识库已经完成闭环的15项江苏医保业务：

1. 职工基本医疗保险参保登记
2. 城乡居民基本医疗保险参保登记
3. 江苏省基本医疗保险异地就医备案
4. 江苏省门诊与住院医疗费用手工（零星）报销
5. 江苏省生育医疗费支付
6. 江苏省职工医保个人账户家庭共济
7. 基本医疗保险单位参保登记
8. 基本医疗保险参保信息变更
9. 基本医疗保险缴费基数申报
10. 基本医疗保险参保信息查询
11. 职工医保个人账户一次性支取
12. 基本医疗保险关系转移接续
13. 门诊慢特病待遇认定
14. 国谈药双通道及单独支付药品待遇认定
15. 生育津贴支付

对应资料位于 `knowledge/documents/`，正文包含适用对象、办理材料、办理渠道、流程、时限、回答边界、核验日期和江苏省医疗保障局官方来源。其他政务事项和尚未进入知识库的医保事项应明确提示“当前未覆盖”，不能依靠模型常识拼凑答案。

## Agent 工作流

每轮问题按固定、可测试的受控流程执行8个工具：

1. `classify_intent`：识别15类医保事项，处理多意图冲突。
2. `extract_slots`：提取参保城市、就医城市、参保险种、人员类型和办理阶段。
3. `update_session_state`：合并多轮对话状态，原型状态保留30分钟。
4. `check_required_slots`：检查必要信息，每次只生成一个优先追问。
5. `search_policy`：执行医保政策混合检索。
6. `get_service_guide`：按照标准事项编码取得办事指南。
7. `assess_evidence`：检查资料是否存在、是否过期、信息是否完整。
8. `generate_material_checklist`：按照事项和人员类别生成材料清单。

`POST /api/chat` 会返回 `agent` 调试字段，包括意图、置信度、槽位、缺失信息、证据判断、引用检查和工具轨迹。当前属于确定性工作流型 Agent，不是让大模型自由调用任意工具的开放式 Agent。

## 混合 RAG

知识入库和查询流程：

```text
48份医保Markdown资料
→ 按标题进行章节感知切片
→ bge-m3生成1024维向量
→ PostgreSQL + pgvector存储
→ 事项/地区/状态/有效期过滤
→ pg_trgm关键词召回Top-20 + 向量召回Top-20
→ 每个片段独立参与RRF融合（不按文档提前去重）
→ 最低相关度过滤
→ 可选Reranker精排
→ DeepSeek依据证据生成回答
→ 输出[资料N]片段引用
→ 电话、金额、比例、时限及引用编号校验
```

每个片段保存 `chunkId`、片段序号、章节标题、章节类型、适用人群；地区、事项编码、政策有效期和版本由所属文档关联取得。章节类型目前包括适用条件、材料、渠道、流程、时限费用、待遇和注意边界。API来源数据同时返回关键词/向量排名、RRF分数及可选Rerank分数，便于排查召回质量。

数据库不可用时会降级为本地 Markdown 关键词检索。DeepSeek API Key只保存在服务端 `.env` 中，不会发送给浏览器；bge-m3在本机运行，知识正文不会因为向量化发送给第三方。

## Reranker精排

RRF负责融合关键词和向量排名，Reranker进一步读取“问题＋候选片段”并重新判断相关性。项目兼容返回 `results[{ index, relevance_score }]` 的 Jina/Cohere 风格 `/rerank` API：

```dotenv
RERANK_API_URL=https://your-provider.example/v1/rerank
RERANK_API_KEY=your_rerank_api_key_here
RERANK_MODEL=BAAI/bge-reranker-v2-m3
RERANK_TIMEOUT_MS=15000
```

配置后，数据库先通过混合检索取得至少10个候选，再交给Reranker精排并保留最终3条。未配置、超时或接口异常时自动回退到RRF顺序，问答不会因此中断。`GET /api/health` 会显示Reranker是否启用；`POST /api/chat` 的 `agent.reranker` 会显示本轮是否实际完成精排。

当前提交只增加Reranker能力和接口适配，不会自动下载额外的大模型。若使用本地 `bge-reranker-v2-m3`，需要另行部署提供 `/rerank` HTTP接口的推理服务；Ollama现有的 `/api/embed` 只用于Embedding，不能直接替代Cross-Encoder精排接口。

## 本地运行

前置条件：Node.js、Docker Desktop。

```bash
npm install
cp .env.example .env
```

在 `.env` 中填写 `DEEPSEEK_API_KEY`，然后执行：

```bash
npm run db:start
npm run db:model
npm run db:ingest
npm run dev
```

`db:model` 只需在首次下载或更换模型时运行。生产方式：

```bash
npm run build
npm start
```

## 知识库维护

当前知识库包含48份资料和509个已向量化片段。新增或修改医保Markdown后先做校验再入库：

```bash
npm run knowledge:sync
npm run knowledge:validate
npm run db:ingest
```

导入脚本使用内容哈希和`ingest_version`执行增量向量化：未变化文档直接复用原片段；正文、切片大小、Embedding模型或向量维度变化时才重建。已经从目录移除的旧资料会标记为`archived`。

可通过 `GET /api/health` 检查数据库连接、已发布文档数、向量状态和 Agent 工具。

## 测试与评测

```bash
npm test
npm run eval:retrieval
npm run build
```

文档级固定评测集位于 `evaluation/retrieval-cases.js`，覆盖15项医保业务、165种问法；片段级评测集位于 `evaluation/chunk-retrieval-cases.js`，覆盖每类意图的材料、渠道、条件、待遇或时限章节。评测输出意图准确率、文档Top-1/Top-3以及片段Top-1/Top-3。这不等于真实生产准确率；仍需持续加入真实用户问法、错别字、越界问题、多轮对话和对抗样本。

## 生产化待办

- 使用 Redis 或数据库保存加密后的会话状态
- 扩充片段级困难评测，并通过A/B评测决定是否启用Reranker
- 建立政策增量更新、审核、发布、失效和回滚流程
- 增加敏感信息识别、权限控制、审计日志和人工转接
- 建立真实标注集及检索、回答、延迟和失败率监控
