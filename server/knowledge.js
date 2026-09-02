import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const aliasGroups = [
  ['职工参保', '职工医保', '员工医保', '单位医保', '单位参保'],
  ['居民参保', '居民医保', '城乡医保', '城乡居民医保', '学生医保'],
  ['异地就医', '跨省就医', '跨省看病', '外地看病', '外省看病', '异地备案'],
  ['医疗报销', '费用报销', '住院报销', '门诊报销', '零星报销', '手工报销'],
  ['生育医疗费', '生育报销', '生孩子报销', '分娩费用', '产检报销']
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
  const expanded = new Set(query.toLowerCase().split(/[\s，。！？、；：,.!?;:（）()]+/).filter(term => term.length > 1))
  for (const group of aliasGroups) {
    if (group.some(alias => normalized.includes(alias))) group.forEach(alias => expanded.add(alias))
  }
  for (let index = 0; index < normalized.length - 1; index += 1) expanded.add(normalized.slice(index, index + 2))
  return expanded
}

export function searchKnowledge(documents, query, limit = 4) {
  const terms = queryTerms(query)
  return documents
    .map(document => {
      const title = `${document.title || ''}${document.topic || ''}${document.keywords || ''}${document.department || ''}`.toLowerCase()
      const text = `${title}${document.body}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (title.includes(term)) score += 5
        else if (text.includes(term)) score += 1
      }
      if (document.priority === 'high' && score > 0) score += 3
      return { document, score }
    })
    .filter(result => result.score >= 2)
    .sort((a, b) => b.score - a.score || a.document.filename.localeCompare(b.document.filename))
    .slice(0, limit)
    .map(result => result.document)
}
