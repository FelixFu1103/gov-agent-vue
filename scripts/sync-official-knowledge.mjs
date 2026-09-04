import { readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('knowledge/documents')
const sources = JSON.parse(await readFile(resolve('knowledge/official-sources.json'), 'utf8'))
const verifiedAt = new Date().toISOString().slice(0, 10)
const managedHtmlFiles = new Set(sources.filter(source => source.type === 'html').map(source => `official-${source.id}.md`))
for (const filename of await readdir(root)) {
  if ((filename.startsWith('official-faq-') || managedHtmlFiles.has(filename)) && filename.endsWith('.md')) await unlink(resolve(root, filename))
}

function decodeHtml(text) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => entities[name])
}

function cleanHtml(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function metadata(source, title, publicationDate, serviceCode = source.service_code || '') {
  const keywords = title.replace(/[？?，。、：“”《》（）()]/g, ' ').replace(/\s+/g, ' ').trim()
  return `---\ntitle: ${title}\ndepartment: ${source.department}\nregion: ${source.region}\nservice_code: ${serviceCode}\npolicy_level: ${source.policy_level}\ncontent_kind: ${source.content_kind}\nkeywords: ${keywords}\nsource: ${source.url}\nverified_at: ${verifiedAt}\npublication_date: ${publicationDate || ''}\npriority: normal\nversion_note: 官方网页同步副本；回答时应结合生效日期、地域和最新替代文件核验\n---\n`
}

function inferServiceCode(title) {
  if (/异地就医|异地备案/.test(title)) return 'cross_region_medical_filing'
  if (/零星报销|手工报销/.test(title)) return 'medical_expense_reimbursement'
  if (/生育津贴/.test(title)) return 'maternity_allowance_payment'
  if (/生育|计划生育/.test(title)) return 'maternity_medical_payment'
  if (/居民医保|城乡居民/.test(title)) return 'medical_resident_enrollment'
  if (/职工医保|参保职工/.test(title)) return 'medical_employee_enrollment'
  return ''
}

async function fetchHtml(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'JiangsuMedicalInsuranceKnowledgeSync/1.0' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return response.text()
}

function parseArticle(html) {
  const title = html.match(/<meta\s+name=["']ArticleTitle["']\s+content=["']([^"']+)/i)?.[1]
    || html.match(/<p[^>]*class=["'][^"']*con-title[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]
    || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  const publicationDate = html.match(/(?:发布日期|生成日期|发布时间)[：:]?\s*(\d{4}-\d{1,2}-\d{1,2})/)?.[1]
  const marked = html.match(/<meta\s+name=["']ContentStart["']\s*>([\s\S]*?)<meta\s+name=["']ContentEnd["']\s*>/i)?.[1]
  const viewStart = html.search(/<div[^>]*class=["'][^"']*(?:TRS_Editor|TRS_UEDITOR|trs_word)[^"']*["'][^>]*>/i)
  let viewBody = ''
  if (viewStart >= 0) {
    const openingEnd = html.indexOf('>', viewStart) + 1
    const ending = html.indexOf('<div style=" margin-left', openingEnd)
    viewBody = html.slice(openingEnd, ending > openingEnd ? ending : undefined)
  }
  const main = marked || viewBody || html.match(/<div[^>]*class=["'][^"']*main-txt[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
  const content = cleanHtml(main || '')
  return { title: cleanHtml(title || '未命名医保资料'), publicationDate, content }
}

async function syncArticle(source, url = source.url, suffix = source.id, serviceCode) {
  const article = parseArticle(await fetchHtml(url))
  if (article.content.length < 80) throw new Error(`正文过短，拒绝发布：${url}`)
  const resolved = { ...source, url }
  const markdown = `${metadata(resolved, article.title, article.publicationDate, serviceCode)}\n## 官方正文\n\n${article.content}\n`
  await writeFile(resolve(root, `official-${suffix}.md`), markdown)
  return { file: `official-${suffix}.md`, chars: article.content.length }
}

const results = []
const skipped = []
for (const source of sources) {
  if (source.type === 'html') {
    try {
      results.push(await syncArticle(source))
    } catch (error) {
      skipped.push({ url: source.url, reason: error.message })
    }
    continue
  }
  if (source.type === 'jiangsu-faq-list') {
    const listHtml = await fetchHtml(source.url)
    const links = [...listHtml.matchAll(/href=['"]([^'"]*art_73932_[^'"]+\.html)['"][^>]*title=['"]([^'"]+)/g)]
    for (const [index, match] of links.entries()) {
      const url = new URL(match[1], source.url).href
      const title = decodeHtml(match[2])
      const faqSource = { ...source, url }
      try {
        results.push(await syncArticle(faqSource, url, `faq-${String(index + 1).padStart(2, '0')}`, inferServiceCode(title)))
      } catch (error) {
        skipped.push({ url, reason: error.message })
      }
    }
  }
}
console.log(JSON.stringify({ synced: results.length, skipped, characters: results.reduce((sum, item) => sum + item.chars, 0), files: results }, null, 2))
