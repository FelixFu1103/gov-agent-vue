# 江苏医保知识库

该目录保存江苏医保 Agent 已进入检索范围的受控资料。当前有48份Markdown、509个向量片段：15份人工整理的高优先级办事指南，以及来自江苏省医疗保障局、南京市医疗保障局的官方问答、政策网页、办事指南PDF和异地就医规程正文。

## 文档要求

每份资料使用带元数据的 Markdown，至少包含：

- `title`：事项名称
- `department`：主管部门
- `region`：适用地区
- `service_code`：对应Agent意图；跨事项综合资料可留空
- `policy_level`：省级或市级
- `content_kind`：办事指南、政策文件、政策解读、官方问答或经办规程
- `topic` 和 `keywords`：检索辅助信息
- `source`：可直接浏览的官方网页原文地址
- `source_document`：官方PDF或附件原文地址（如有）
- `verified_at`：最近人工核验日期
- `version_note`：政策版本和适用边界

正文应按“适用对象、办理材料、办理渠道、办理流程、办理时限、回答边界”等标题组织。不得把未经核验的搜索摘要、模型生成内容或非官方二手解读直接作为知识正文。

## 更新流程

1. 执行 `npm run knowledge:sync` 同步配置清单中的官方网页和江苏医保知识问答。
2. PDF来源变化时执行 `python3 scripts/extract-official-pdfs.py`（需安装`pypdf`）。
3. 执行 `npm run knowledge:validate`，不允许带错误入库。
4. 业务审核人员核对官方来源、地区、生效状态和正文。
5. 执行 `npm run db:ingest`；只有正文、切片配置或Embedding模型发生变化的文档才重新向量化。
6. 执行 `npm test` 和 `npm run eval:retrieval`。
7. 检查失败样本后提交Git，由审核人员批准发布。

从 `documents/` 删除的资料不会继续作为已发布知识使用；再次导入时，数据库中的对应记录会标记为 `archived`，以保留审计历史。

自动同步得到的是“官方来源副本”，不等于已经完成业务审批。生产发布前仍应由医保业务人员确认文件未废止、未被新文件替代，特别是包含待遇金额和比例的市级政策。
