function normalize(text) {
  return text.toLowerCase().replace(/[\s，。；：、,.!?！？（）()]/g, '')
}

export function verifyGeneratedAnswer(answer, evidenceDocuments) {
  const evidence = normalize(evidenceDocuments.map(document => document.body || '').join('\n'))
  const riskyPattern = /(\d+(?:\.\d+)?\s*(?:个)?(?:工作日|日|天|小时|元|%|％))|(\b\d{5,}\b)/g
  const unsupportedClaims = []
  const keptLines = answer.split('\n').filter(line => {
    const claims = [...line.matchAll(riskyPattern)].map(match => match[0])
    const unsupported = claims.filter(claim => !evidence.includes(normalize(claim)))
    unsupportedClaims.push(...unsupported)
    return unsupported.length === 0
  })
  let sanitizedAnswer = keptLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (unsupportedClaims.length) sanitizedAnswer += '\n\n提示：已移除知识资料无法支持的数字、金额、比例或联系方式。'
  return {
    answer: sanitizedAnswer,
    passed: unsupportedClaims.length === 0,
    unsupportedClaims: [...new Set(unsupportedClaims)]
  }
}
