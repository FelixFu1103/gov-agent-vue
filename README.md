# 江苏医保 Agent

面向江苏省基本医疗保险业务的智能咨询 Agent。前端使用 Vue 3 + Vite，后端使用 Node.js；DeepSeek 负责依据证据组织回答，PostgreSQL + pgvector、Ollama + bge-m3 负责本地混合知识检索。

> 当前是学习与验证版本，不代表医保经办机构。政策和各市执行口径可能调整，最终以参保地医保部门最新规定为准。

## 当前覆盖范围

系统只回答知识库已经完成闭环的6项江苏医保业务：

1. 职工基本医疗保险参保登记
2. 城乡居民基本医疗保险参保登记
3. 江苏省基本医疗保险异地就医备案
4. 江苏省门诊与住院医疗费用手工（零星）报销
5. 江苏省生育医疗费支付
6. 江苏省职工医保个人账户家庭共济

对应资料位于 `knowledge/documents/`，正文包含适用对象、办理材料、办理渠道、流程、时限、回答边界、核验日期和江苏省医疗保障局官方来源。其他政务事项和尚未进入知识库的医保事项应明确提示“当前未覆盖”，不能依靠模型常识拼凑答案。

## Agent 工作流

每轮问题按固定、可测试的受控流程执行8个工具：

1. `classify_intent`：识别6类医保事项，处理多意图冲突。
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
医保 Markdown资料
→ 按标题进行章节感知切片
→ bge-m3生成1024维向量
→ PostgreSQL + pgvector存储
→ 事项/地区/状态/有效期过滤
→ pg_trgm关键词召回Top-20 + 向量召回Top-20
→ RRF融合和文档去重
→ 最低相关度过滤
→ DeepSeek依据证据生成回答
→ 电话、金额、比例和时限引用校验
```

数据库不可用时会降级为本地 Markdown 关键词检索。DeepSeek API Key只保存在服务端 `.env` 中，不会发送给浏览器；bge-m3在本机运行，知识正文不会因为向量化发送给第三方。

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

新增或修改医保 Markdown 后必须重新入库。导入脚本会更新当前文件、重新生成切片和向量，并把已经从目录移除的旧资料标记为 `archived`：

```bash
npm run db:ingest
```

可通过 `GET /api/health` 检查数据库连接、已发布文档数、向量状态和 Agent 工具。

## 测试与评测

```bash
npm test
npm run eval:retrieval
npm run build
```

固定评测集位于 `evaluation/retrieval-cases.js`，覆盖6项医保业务、120种问法，输出意图准确率、Top-1准确率和Top-3召回率。这不等于真实生产准确率；仍需持续加入真实用户问法、错别字、越界问题、多轮对话和对抗样本。

## 生产化待办

- 使用 Redis 或数据库保存加密后的会话状态
- 增加片段级 Reranker 与逐结论引用
- 建立政策增量更新、审核、发布、失效和回滚流程
- 增加敏感信息识别、权限控制、审计日志和人工转接
- 建立真实标注集及检索、回答、延迟和失败率监控
