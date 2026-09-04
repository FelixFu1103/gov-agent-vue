function normalize(text) {
  return text.toLowerCase().replace(/[\s，。；：、,.!?！？（）()]/g, '')
}

export function verifyGeneratedAnswer(answer, evidenceDocuments) {
  const evidence = normalize(evidenceDocuments.map(document => document.body || '').join('\n'))
  const riskyPattern = /(\d+(?:\.\d+)?\s*(?:个)?(?:工作日|日|天|小时|元|%|％))|(\b\d{5,}\b)/g
  const unsupportedClaims = []
  const invalidReferences = []
  const keptLines = answer.split('\n').filter(line => {
    const claims = [...line.matchAll(riskyPattern)].map(match => match[0])
    const unsupported = claims.filter(claim => !evidence.includes(normalize(claim)))
    const references = [...line.matchAll(/\[资料(\d+)\]/g)].map(match => Number(match[1]))
    const invalid = references.filter(reference => reference < 1 || reference > evidenceDocuments.length)
    unsupportedClaims.push(...unsupported)
    invalidReferences.push(...invalid)
    return unsupported.length === 0 && invalid.length === 0
  })
  let sanitizedAnswer = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (unsupportedClaims.length || invalidReferences.length) sanitizedAnswer += '\n\n提示：已移除知识资料无法支持的内容或引用。'
  const citedReferences = [...sanitizedAnswer.matchAll(/\[资料(\d+)\]/g)].map(match => Number(match[1]))
  return {
    answer: sanitizedAnswer,
    passed: unsupportedClaims.length === 0 && invalidReferences.length === 0,
    unsupportedClaims: [...new Set(unsupportedClaims)],
    invalidReferences: [...new Set(invalidReferences)],
    citedReferences: [...new Set(citedReferences)]
  }
}
