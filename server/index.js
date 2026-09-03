import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { loadKnowledge } from './knowledge.js'
import { agentToolDefinitions, runAgentTools } from './agent-tools.js'
import { createKnowledgeDatabase } from './database.js'
import { verifyGeneratedAnswer } from './citation-verifier.js'
import { createKnowledgeReranker } from './reranker.js'

const port = Number(process.env.PORT || 8787)
const distRoot = resolve('dist')
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const knowledgeRoot = resolve('knowledge/documents')
const knowledgeReranker = createKnowledgeReranker()

const instructions = `你是江苏医保智能咨询 Agent，仅处理江苏省基本医疗保险相关咨询。
请使用简洁、准确、易懂的中文回答。始终回答用户最新一轮问题，并结合历史对话中已经确认的城市、参保险种、人员身份和办理阶段，不要重复询问已经给出的信息。
回答必须便于网页阅读，并严格使用以下纯文本结构：
结论：用1至2句话直接回答。

办理建议：
1. 每一步只说一件事，每项不超过两句话。
2. 总计不超过5项。

需要确认：仅列出影响结论但尚未获得的信息；如果没有则省略。
不要使用 Markdown 标记，不要输出 **、##、表格或大段连续文字。整篇尽量控制在500个汉字以内。
当前仅覆盖职工医保参保登记、城乡居民医保参保登记、异地就医备案、门诊与住院医疗费用手工（零星）报销、生育医疗费支付、职工医保个人账户家庭共济6类事项。用户咨询其他政务或医保事项时，明确说明当前知识库尚未覆盖，不得使用常识拼凑回答。
你会收到从江苏医保知识库检索出的参考资料。只能依据这些资料陈述医保事项；不得编造法规、办理材料、费用、时限或主管部门。
涉及地区差异时先询问用户所在省市；涉及个人办件、身份信息、法律结论或重大权益时，提醒用户以当地政府官网和主管部门答复为准。
不得要求用户提供身份证号、银行卡号、密码、验证码等敏感信息。
如果资料只证明官方门户存在某事项、但不包含具体材料或时限，必须明确说明，并引导用户通过给出的官方来源核验。没有相关资料时要明确说明知识库暂未覆盖。资料没有提供电话、金额或具体比例时，禁止自行补充。`

let knowledgeDocuments = []
try {
  knowledgeDocuments = await loadKnowledge(knowledgeRoot)
} catch (error) {
  console.error('Knowledge base load failed:', error?.message)
}

let knowledgeDatabase = null
try {
  knowledgeDatabase = await createKnowledgeDatabase()
  if (knowledgeDatabase) console.log('Knowledge database connected')
} catch (error) {
  console.warn('Knowledge database unavailable, using Markdown fallback:', error.message)
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 32_000) throw new Error('请求内容过长')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function requestDeepSeek(payload) {
  const apiResponse = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45_000)
  })
  const result = await apiResponse.json()
  return { apiResponse, result }
}

async function handleChat(request, response) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return sendJson(response, 503, { error: '服务端尚未配置 DEEPSEEK_API_KEY' })
  }

  let body
  try {
    body = await readJson(request)
  } catch {
    return sendJson(response, 400, { error: '请求格式不正确' })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const conversationId = typeof body.conversationId === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(body.conversationId)
    ? body.conversationId
    : crypto.randomUUID()
  if (!message) return sendJson(response, 400, { error: '请输入咨询问题' })
  if (message.length > 2_000) return sendJson(response, 400, { error: '问题不能超过 2000 个字符' })

  const history = Array.isArray(body.history)
    ? body.history
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      .slice(-10)
      .map(item => ({ role: item.role, content: item.content.slice(0, 4_000) }))
    : []
  const agent = await runAgentTools({
    conversationId,
    message,
    history,
    documents: knowledgeDocuments,
    databaseSearch: knowledgeDatabase?.search,
    rerank: knowledgeReranker.enabled ? knowledgeReranker.rerank : null
  })
  const matches = agent.policies.slice(0, 1)
  const context = matches.length
    ? matches.map((document, index) => `[资料${index + 1}]\n标题：${document.title}\n部门：${document.department}\n地区：${document.region}\n核验日期：${document.verifiedAt}\n官方来源：${document.source}\n内容：${document.body}`).join('\n\n')
    : '未检索到相关的本地知识库资料。'
  const payload = {
    model,
    messages: [
      { role: 'system', content: instructions },
      ...history,
      { role: 'user', content: `Agent当前状态：\n意图：${agent.state.intent}\n已确认信息：${JSON.stringify(agent.state.slots)}\n仍缺信息：${agent.slotCheck.missing.join('、') || '无'}\n下一追问：${agent.slotCheck.nextQuestion || '无'}\n证据判断：${agent.evidence.reason}\n建议材料清单：${agent.checklist.items.join('；') || '暂无'}\n\n本次检索资料：\n${context}\n\n用户最新问题：${message}\n\n请依据资料回答；如果仍缺信息，在提供现有通用结论后，只追问“下一追问”中的一个问题。` }
    ],
    stream: false,
    max_tokens: 4096
  }

  try {
    let { apiResponse, result } = await requestDeepSeek(payload)
    if (!apiResponse.ok) {
      console.error('DeepSeek API error:', apiResponse.status, result?.error?.code)
      return sendJson(response, 502, { error: 'AI 服务暂时不可用，请稍后重试' })
    }

    let answer = result.choices?.[0]?.message?.content?.trim()
    if (!answer) {
      console.warn('DeepSeek returned empty content, retrying:', result.choices?.[0]?.finish_reason || 'unknown')
      const retryPayload = {
        ...payload,
        messages: [...payload.messages, { role: 'user', content: '请直接输出对上一问题的最终中文答复，不要返回空内容。' }]
      }
      ;({ apiResponse, result } = await requestDeepSeek(retryPayload))
      if (!apiResponse.ok) {
        console.error('DeepSeek retry error:', apiResponse.status, result?.error?.code)
        return sendJson(response, 502, { error: 'AI 服务暂时不可用，请稍后重试' })
      }
      answer = result.choices?.[0]?.message?.content?.trim()
    }

    if (!answer) return sendJson(response, 502, { error: 'AI 连续两次未返回回答，请重新发送问题' })
    const verification = verifyGeneratedAnswer(answer, matches)
    answer = verification.answer
    return sendJson(response, 200, {
      answer,
      model: result.model || model,
      conversationId,
      agent: {
        intent: agent.state.intent,
        confidence: agent.state.confidence,
        slots: agent.state.slots,
        missingSlots: agent.slotCheck.missing,
        evidence: agent.evidence,
        citationVerification: { passed: verification.passed, removedClaims: verification.unsupportedClaims },
        reranker: { enabled: knowledgeReranker.enabled, model: knowledgeReranker.model, applied: matches.some(document => Number.isFinite(document.rerankScore)) },
        tools: agent.trace
      },
      sources: matches.map(document => ({ title: document.title, department: document.department, url: document.source, documentUrl: document.sourceDocument }))
    })
  } catch (error) {
    console.error('Chat request failed:', error?.name)
    return sendJson(response, 502, { error: '连接 AI 服务失败，请稍后重试' })
  }
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, 'http://localhost').pathname
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '')
  let filePath = resolve(join(distRoot, normalized))
  if (!filePath.startsWith(distRoot)) return sendJson(response, 403, { error: '禁止访问' })

  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = join(filePath, 'index.html')
    const data = await readFile(filePath)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' })
    response.end(data)
  } catch {
    try {
      const data = await readFile(join(distRoot, 'index.html'))
      response.writeHead(200, { 'Content-Type': mimeTypes['.html'] })
      response.end(data)
    } catch {
      sendJson(response, 404, { error: '请先运行 npm run build' })
    }
  }
}

createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/api/chat') return handleChat(request, response)
  if (request.method === 'GET' && request.url === '/api/health') {
    const database = knowledgeDatabase ? await knowledgeDatabase.health() : { connected: false, documents: 0, vectorEnabled: false }
    return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY), model, knowledgeDocuments: knowledgeDocuments.length, database, reranker: { enabled: knowledgeReranker.enabled, model: knowledgeReranker.model }, agentTools: agentToolDefinitions })
  }
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  return sendJson(response, 405, { error: '不支持的请求方法' })
}).listen(port, '127.0.0.1', () => {
  console.log(`API server running at http://127.0.0.1:${port}`)
})
