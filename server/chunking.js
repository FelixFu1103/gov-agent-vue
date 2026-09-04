const sectionTypeRules = [
  ['materials', /材料|凭证|资料/],
  ['deadline_fee', /时限|费用|收费/],
  ['eligibility', /适用|对象|条件|资格/],
  ['channels', /渠道|方式|入口/],
  ['process', /流程|步骤/],
  ['benefits', /待遇|支付范围|使用范围|结算|报销比例/],
  ['cautions', /提示|边界|注意|安全|隐私|规则|管理/]
]

export function inferSectionType(title = '') {
  return sectionTypeRules.find(([, pattern]) => pattern.test(title))?.[0] || 'general'
}

export function inferQuerySectionType(query = '') {
  const normalized = query.replace(/\s+/g, '')
  if (/(多久|多长时间|几天|工作日|即时办结|收费吗|是否收费|多少钱)/.test(normalized)) return 'deadline_fee'
  if (/(哪些材料|什么材料|带什么|提交什么|需要.*(?:票据|证明|资料|申请表)|票据|申请表)/.test(normalized)) return 'materials'
  if (/(在哪里|从哪里|什么渠道|办理入口|网上|线上|窗口)/.test(normalized)) return 'channels'
  if (/(可以.*(?:支付|使用)|能.*(?:支付|使用|干什么)|使用范围|用途|待遇范围)/.test(normalized)) return 'benefits'
  if (/(什么情况|哪些人|谁能|适用对象|申请条件|资格)/.test(normalized)) return 'eligibility'
  if (/(流程|步骤|怎么办理|如何办理)/.test(normalized)) return 'process'
  if (/(注意|限制|不能|边界|风险)/.test(normalized)) return 'cautions'
  return null
}

export function inferAudience(text = '') {
  const audiences = []
  if (/用人单位|企业|单位经办/.test(text)) audiences.push('用人单位')
  if (/职工医保|参保职工|职工基本医疗保险/.test(text)) audiences.push('职工医保参保人')
  if (/居民医保|城乡居民|学生医保/.test(text)) audiences.push('居民医保参保人')
  if (/灵活就业/.test(text)) audiences.push('灵活就业人员')
  if (/男职工|未就业配偶/.test(text)) audiences.push('男职工及未就业配偶')
  if (/女职工|生育/.test(text)) audiences.push('参保女职工')
  return [...new Set(audiences)].join('、') || '医保参保人'
}

function plainHeading(markdownHeading = '') {
  return markdownHeading.replace(/^#{1,4}\s+/, '').trim()
}

export function splitIntoKnowledgeChunks(text, maxSize = 800, overlap = 120) {
  const normalized = text.replace(/\r/g, '').trim()
  const sections = normalized.split(/(?=^#{1,4}\s+)/m).filter(Boolean)
  const chunks = []

  for (const section of sections.length ? sections : [normalized]) {
    const heading = section.match(/^(#{1,4}\s+[^\n]+)/)?.[1] || ''
    const sectionTitle = plainHeading(heading) || '正文'
    const sectionType = inferSectionType(sectionTitle)
    let remaining = section.trim()
    while (remaining.length > maxSize) {
      let end = maxSize
      const boundary = Math.max(remaining.lastIndexOf('\n', end), remaining.lastIndexOf('。', end))
      if (boundary > maxSize / 2) end = boundary + 1
      chunks.push({ content: remaining.slice(0, end).trim(), sectionTitle, sectionType })
      const tail = remaining.slice(Math.max(0, end - overlap), end).replace(/^.*?[。\n]/, '')
      remaining = `${heading ? `${heading}\n` : ''}${tail}${remaining.slice(end)}`.trim()
    }
    if (remaining) chunks.push({ content: remaining, sectionTitle, sectionType })
  }
  return chunks.filter(chunk => chunk.content)
}

export function splitBySections(text, maxSize = 800, overlap = 120) {
  return splitIntoKnowledgeChunks(text, maxSize, overlap).map(chunk => chunk.content)
}
