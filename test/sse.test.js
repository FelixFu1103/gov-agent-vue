import test from 'node:test'
import assert from 'node:assert/strict'
import { readDeepSeekStream } from '../server/sse.js'

test('reads DeepSeek SSE chunks split across network boundaries', async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"江苏"}}]}\n'))
      controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"content":"医保"}}]}\n\ndata: [DONE]\n\n'))
      controller.close()
    }
  })
  const deltas = []
  assert.equal(await readDeepSeekStream(body, text => deltas.push(text)), '江苏医保')
  assert.deepEqual(deltas, ['江苏', '医保'])
})
