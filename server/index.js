import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const port = Number(process.env.PORT || 8787)
const distRoot = resolve('dist')
const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'

const instructions = `你是政务服务智能咨询助手。
请使用简洁、准确、易懂的中文回答。
当前尚未接入权威政务知识库，因此不得声称某项政策一定有效，也不得编造法规、办理材料、时限或主管部门。
涉及地区差异时先询问用户所在省市；涉及个人办件、身份信息、法律结论或重大权益时，提醒用户以当地政府官网和主管部门答复为准。
不得要求用户提供身份证号、银行卡号、密码、验证码等敏感信息。
如果没有可靠依据，要明确说明不确定，并告诉用户应该向哪个类型的官方部门核实。`

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
  const payload = {
    model,
    messages: [
      { role: 'system', content: instructions },
      ...history,
      { role: 'user', content: message }
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
    return sendJson(response, 200, { answer, model: result.model || model })
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
    return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.DEEPSEEK_API_KEY), model })
  }
  if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(request, response)
  return sendJson(response, 405, { error: '不支持的请求方法' })
}).listen(port, '127.0.0.1', () => {
  console.log(`API server running at http://127.0.0.1:${port}`)
})
