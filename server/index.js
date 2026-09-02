import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.env.PORT || 8787)
const distRoot = resolve('dist')
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
const knowledgeRoot = resolve('knowledge/documents')

const instructions = `你是政务服务智能咨询助手。
请使用简洁、准确、易懂的中文回答。
你会收到从江苏政务知识库检索出的参考资料。只能依据这些资料陈述政务事项；不得编造法规、办理材料、费用、时限或主管部门。
涉及地区差异时先询问用户所在省市；涉及个人办件、身份信息、法律结论或重大权益时，提醒用户以当地政府官网和主管部门答复为准。
不得要求用户提供身份证号、银行卡号、密码、验证码等敏感信息。
如果资料只证明官方门户存在某事项、但不包含具体材料或时限，必须明确说明，并引导用户通过给出的官方来源核验。没有相关资料时要明确说明知识库暂未覆盖。`

function parseDocument(filename, raw) {
  const [, header = '', body = raw] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) || []
  const metadata = Object.fromEntries(header.split('\n').filter(Boolean).map(line => {
    const splitAt = line.indexOf(':')
    return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()]
  }))
  return { filename, ...metadata, body: body.trim() }
}

async function loadKnowledge() {
  try {
    const files = (await readdir(knowledgeRoot)).filter(file => file.endsWith('.md')).sort()
    return Promise.all(files.map(async filename => parseDocument(filename, await readFile(join(knowledgeRoot, filename), 'utf8'))))
  } catch (error) {
    console.error('Knowledge base load failed:', error?.message)
    return []
  }
}

const knowledgeDocuments = await loadKnowledge()

function searchKnowledge(query, limit = 4) {
  const normalized = query.toLowerCase().replace(/\s+/g, '')
  const terms = new Set([
    ...query.toLowerCase().split(/[\s，。！？、；：,.!?;:（）()]+/).filter(term => term.length > 1),
    ...Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2))
  ])
  return knowledgeDocuments
    .map(document => {
      const title = `${document.title || ''}${document.topic || ''}${document.department || ''}`.toLowerCase()
      const text = `${title}${document.body}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (title.includes(term)) score += 4
        else if (text.includes(term)) score += 1
      }
      return { document, score }
    })
    .filter(result => result.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(result => result.document)
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
  if (!message) return sendJson(response, 400, { error: '请输入咨询问题' })
  if (message.length > 2_000) return sendJson(response, 400, { error: '问题不能超过 2000 个字符' })

  const history = Array.isArray(body.history)
    ? body.history
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      .slice(-10)
      .map(item => ({ role: item.role, content: item.content.slice(0, 4_000) }))
    : []
  const matches = searchKnowledge(message)
  const context = matches.length
    ? matches.map((document, index) => `[资料${index + 1}]\n标题：${document.title}\n部门：${document.department}\n地区：${document.region}\n核验日期：${document.verified_at}\n官方来源：${document.source}\n内容：${document.body}`).join('\n\n')
    : '未检索到相关的本地知识库资料。'
  const payload = {
    model,
    messages: [
      { role: 'system', content: instructions },
      ...history,
      { role: 'user', content: `本次检索资料：\n${context}\n\n用户问题：${message}` }
    ],
    stream: false,
    max_tokens: 900
  }

  try {
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
    if (!apiResponse.ok) {
      console.error('DeepSeek API error:', apiResponse.status, result?.error?.code)
      return sendJson(response, 502, { error: 'AI 服务暂时不可用，请稍后重试' })
    }

    const answer = result.choices?.[0]?.message?.content?.trim()

    if (!answer) return sendJson(response, 502, { error: 'AI 未返回可显示的回答' })
    return sendJson(response, 200, {
      answer,
      model: result.model || model,
      sources: matches.map(document => ({ title: document.title, department: document.department, url: document.source }))
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
    return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY), model, knowledgeDocuments: knowledgeDocuments.length })
  }
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  return sendJson(response, 405, { error: '不支持的请求方法' })
}).listen(port, '127.0.0.1', () => {
  console.log(`API server running at http://127.0.0.1:${port}`)
})
