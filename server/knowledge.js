import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const aliasGroups = [
  ['职工参保', '职工医保', '员工医保', '单位医保', '单位参保'],
  ['居民参保', '居民医保', '城乡医保', '城乡居民医保', '学生医保'],
  ['异地就医', '跨省就医', '跨省看病', '外地看病', '外省看病', '异地备案'],
  ['医疗报销', '费用报销', '住院报销', '门诊报销', '零星报销', '手工报销'],
  ['生育医疗费', '生育报销', '生孩子报销', '分娩费用', '产检报销'],
  ['家庭共济', '医保共济', '医疗共济', '个人账户共济', '亲情账户']
]

export function parseDocument(filename, raw) {
  const [, header = '', body = raw] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) || []
  const metadata = Object.fromEntries(header.split('\n').filter(Boolean).map(line => {
    const splitAt = line.indexOf(':')
    return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()]
  }))
  return { filename, ...metadata, body: body.trim() }
}

export async function loadKnowledge(knowledgeRoot) {
  const files = (await readdir(knowledgeRoot)).filter(file => file.endsWith('.md')).sort()
  return Promise.all(files.map(async filename => parseDocument(filename, await readFile(join(knowledgeRoot, filename), 'utf8'))))
}

function queryTerms(query) {
  const normalized = query.toLowerCase().replace(/\s+/g, '')
  const expanded = query.toLowerCase().split(/[\s，。！？、；：,.!?;:（）()]+/).filter(term => term.length > 1)
  for (const group of aliasGroups) {
    if (group.some(alias => normalized.includes(alias))) expanded.push(...group)
  }
  for (let index = 0; index < normalized.length - 1; index += 1) expanded.push(normalized.slice(index, index + 2))
  return expanded
}

function inferIntent(query) {
  if (/(家庭|医保|医疗|个人账户|亲情账户).*(共济|家人|父母|子女|孩子|配偶)|(共济).*(医保|医疗|账户)/.test(query)) return '家庭共济'
  if (/(异地|外省|跨省|外地).*(就医|看病|住院|医院|备案)|(就医|看病|住院).*(异地|外省|跨省|外地)/.test(query)) return '异地就医'
  if (/(生育|生孩子|分娩|产检).*(费用|报销|支付)/.test(query)) return '生育医疗费'
  if (/(门诊|住院|医疗).*(报销|零星|手工|未结算)/.test(query)) return '医疗报销'
  if (/(居民|城乡|学生).*(医保|参保)/.test(query)) return '居民参保'
  if (/(职工|员工|单位|灵活就业).*(医保|参保)/.test(query)) return '职工参保'
  return ''
}

export function searchKnowledge(documents, query, limit = 4) {
  const terms = queryTerms(query)
  const intent = inferIntent(query)
  return documents
    .map(document => {
      const title = `${document.title || ''}${document.topic || ''}${document.keywords || ''}${document.department || ''}`.toLowerCase()
      const text = `${title}${document.body}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (title.includes(term)) score += 5
        else if (text.includes(term)) score += 1
      }
      if (intent && `${document.topic || ''}${document.title || ''}`.includes(intent)) score += 30
      if (document.priority === 'high' && score > 0) score += 3
      return { document, score }
    })
    .filter(result => result.score >= 2)
    .sort((a, b) => b.score - a.score || a.document.filename.localeCompare(b.document.filename))
    .slice(0, limit)
    .map(result => result.document)
}

export function buildRetrievalQuery(history, message) {
  const priorUserMessages = history
    .filter(item => item.role === 'user')
    .slice(-3)
    .map(item => item.content.trim())
    .filter(Boolean)
  const latestIntent = priorUserMessages.at(-1)
  return [...priorUserMessages, latestIntent, message].filter(Boolean).join('；')
}
