import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { parseKnowledgeUpload } from '../server/knowledge-upload.js'

test('parses a multipart text knowledge upload', async () => {
  const boundary = 'test-boundary'
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n测试医保政策\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.txt"\r\nContent-Type: text/plain\r\n\r\n${'江苏医保政策办理说明。'.repeat(10)}\r\n`,
    `--${boundary}--\r\n`
  ].join('')
  const request = new PassThrough()
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(Buffer.byteLength(body)) }
  request.end(body)
  const document = await parseKnowledgeUpload(request)
  assert.equal(document.title, '测试医保政策')
  assert.match(document.body, /江苏医保政策办理说明/)
})
