export function splitBySections(text, maxSize = 800, overlap = 120) {
  const normalized = text.replace(/\r/g, '').trim()
  const sections = normalized.split(/(?=^#{1,4}\s+)/m).filter(Boolean)
  const chunks = []

  for (const section of sections.length ? sections : [normalized]) {
    const heading = section.match(/^(#{1,4}\s+[^\n]+)/)?.[1] || ''
    let remaining = section.trim()
    while (remaining.length > maxSize) {
      let end = maxSize
      const boundary = Math.max(remaining.lastIndexOf('\n', end), remaining.lastIndexOf('。', end))
      if (boundary > maxSize / 2) end = boundary + 1
      chunks.push(remaining.slice(0, end).trim())
      const tail = remaining.slice(Math.max(0, end - overlap), end).replace(/^.*?[。\n]/, '')
      remaining = `${heading ? `${heading}\n` : ''}${tail}${remaining.slice(end)}`.trim()
    }
    if (remaining) chunks.push(remaining)
  }
  return chunks.filter(Boolean)
}
