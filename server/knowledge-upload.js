import Busboy from 'busboy'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

const maxFileSize = 10 * 1024 * 1024
const allowedExtensions = new Set(['pdf', 'docx', 'txt', 'md', 'html', 'htm'])

function cleanHtml(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => entities[name])
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function assertOfficialUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !(url.hostname === 'gov.cn' || url.hostname.endsWith('.gov.cn'))) {
    throw new Error('网页知识仅支持 HTTPS 的政府官网 gov.cn 链接')
  }
  return url
}

async function readLimitedBody(response, limit = 2 * 1024 * 1024) {
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > limit) throw new Error('网页内容超过 2MB')
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

async function parseFile(file) {
  const extension = file.filename.split('.').pop()?.toLowerCase()
  if (!allowedExtensions.has(extension)) throw new Error('仅支持 PDF、DOCX、TXT、MD、HTML 文件')
  if (extension === 'pdf') {
    const parser = new PDFParse({ data: file.buffer })
    try { return (await parser.getText()).text.trim() } finally { await parser.destroy() }
  }
  if (extension === 'docx') return (await mammoth.extractRawText({ buffer: file.buffer })).value.trim()
  const text = file.buffer.toString('utf8')
  return ['html', 'htm'].includes(extension) ? cleanHtml(text) : text.trim()
}

export async function parseKnowledgeUpload(request) {
  const { fields, file } = await new Promise((resolve, reject) => {
    const fields = {}
    let file = null
    let failed = false
    const fail = error => { if (!failed) { failed = true; reject(error) } }
    let busboy
    try { busboy = Busboy({ headers: request.headers, limits: { files: 1, fileSize: maxFileSize, fields: 8, fieldSize: 4_000 } }) } catch { return fail(new Error('上传格式不正确')) }
    busboy.on('field', (name, value) => { fields[name] = value.trim() })
    busboy.on('file', (_name, stream, info) => {
      const chunks = []
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('limit', () => fail(new Error('文件不能超过 10MB')))
      stream.on('end', () => { file = { filename: info.filename, mimeType: info.mimeType, buffer: Buffer.concat(chunks) } })
    })
    busboy.on('filesLimit', () => fail(new Error('每次只能上传一个文件')))
    busboy.on('error', fail)
    busboy.on('finish', () => { if (!failed) resolve({ fields, file }) })
    request.pipe(busboy)
  })

  let body
  let source
  let defaultTitle
  if (file?.buffer.length) {
    body = await parseFile(file)
    source = fields.source || '本地上传资料'
    defaultTitle = file.filename.replace(/\.[^.]+$/, '')
  } else if (fields.url) {
    const requestedUrl = assertOfficialUrl(fields.url)
    const response = await fetch(requestedUrl, { headers: { 'User-Agent': 'JiangsuMedicalInsuranceKnowledgeUpload/1.0' }, signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`网页读取失败：HTTP ${response.status}`)
    assertOfficialUrl(response.url)
    const html = await readLimitedBody(response)
    body = cleanHtml(html)
    source = response.url
    defaultTitle = cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '官方网页资料')
  } else {
    throw new Error('请选择文件或填写官方网页链接')
  }

  if (body.length < 80) throw new Error('提取到的正文少于 80 个字符，无法入库')
  if (body.length > 2_000_000) throw new Error('提取到的正文超过 200 万字符')
  return {
    title: fields.title || defaultTitle,
    department: fields.department || '江苏省医疗保障部门',
    region: fields.region || '江苏省',
    topic: fields.topic || '医疗保险',
    keywords: fields.keywords || '',
    source,
    body
  }
}
