<script setup>
import { nextTick, ref } from 'vue'

const question = ref('')
const loading = ref(false)
const messageBox = ref(null)
const serviceError = ref('')
const messages = ref([
  { id: 1, role: 'assistant', text: '您好，我是政务服务智能助手。您可以咨询社保、公积金、户籍、企业开办等事项。请告诉我您想办理什么业务？' }
])

const quickQuestions = ['办理营业执照需要什么材料？', '社保转移如何办理？', '异地身份证到期怎么换领？', '公积金提取有哪些条件？']
async function scrollToBottom() {
  await nextTick()
  if (messageBox.value) messageBox.value.scrollTop = messageBox.value.scrollHeight
}

async function ask(text = question.value) {
  const value = text.trim()
  if (!value || loading.value) return
  messages.value.push({ id: Date.now(), role: 'user', text: value })
  question.value = ''
  loading.value = true
  serviceError.value = ''
  const history = messages.value
    .slice(1, -1)
    .filter(message => ['user', 'assistant'].includes(message.role))
    .slice(-10)
    .map(message => ({ role: message.role, content: message.text }))
  await scrollToBottom()

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: value, history })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'AI 服务暂时不可用')
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      text: result.answer,
      source: result.sources?.length
        ? `参考：${result.sources.map(source => `${source.title}（${source.department}）`).join('；')}`
        : `AI 回答 · ${result.model || 'DeepSeek'} · 知识库未命中`
    })
  } catch (error) {
    serviceError.value = error.message
    messages.value.push({ id: Date.now() + 1, role: 'assistant', text: `抱歉，${error.message}。`, source: '系统提示' })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    ask()
  }
}
</script>

<template>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="emblem">政</div><div><strong>政务智答</strong><small>Government Service AI</small></div></div>
      <div class="side-title">服务中心</div>
      <nav class="nav"><button class="active">智能咨询</button><button>办事指南</button><button>政策查询</button><button>咨询记录</button></nav>
      <div class="safe"><strong>隐私提示</strong>请勿在对话中发送身份证号、银行卡号、密码等敏感信息。</div>
    </aside>

    <main>
      <header class="top"><div><h1>政务服务智能咨询</h1><p>办事问题，一问即达</p></div><div class="status"><i></i>服务正常</div></header>
      <div class="notice">AI 接入版本：回答由大模型生成，当前尚未接入权威政务知识库，不构成正式办事依据。</div>

      <div class="workspace">
        <section class="chat" aria-label="智能咨询对话">
          <header class="chat-head"><strong>智能助手</strong><span>{{ serviceError ? '服务需要检查' : 'DeepSeek API' }}</span></header>
          <div ref="messageBox" class="messages" aria-live="polite">
            <div v-for="message in messages" :key="message.id" class="row" :class="{ user: message.role === 'user' }">
              <div class="avatar">{{ message.role === 'user' ? '我' : '政' }}</div>
              <div class="bubble"><p>{{ message.text }}</p><div v-if="message.source" class="source">{{ message.source }}</div></div>
            </div>
            <div v-if="loading" class="row"><div class="avatar">政</div><div class="bubble typing">AI 正在整理回答…</div></div>
          </div>
          <form class="composer" @submit.prevent="ask()">
            <div class="input-wrap"><textarea v-model="question" rows="2" placeholder="例如：办理营业执照需要哪些材料？" aria-label="输入政务咨询问题" @keydown="handleKeydown"></textarea><button :disabled="loading || !question.trim()" type="submit">发送</button></div>
            <p class="hint">按 Enter 发送，Shift + Enter 换行 · AI 回答可能有误，请以办事部门最新规定为准</p>
          </form>
        </section>

        <aside class="panel">
          <section class="card"><h2>常见问题</h2><div class="quick"><button v-for="item in quickQuestions" :key="item" @click="ask(item)">{{ item }}</button></div></section>
          <section class="card"><h2>服务概况</h2><div class="metric"><span>AI 服务</span><strong>DeepSeek API</strong></div><div class="metric"><span>政策知识库</span><strong>江苏 30 份</strong></div><div class="metric"><span>对话模式</span><strong>检索增强</strong></div></section>
        </aside>
      </div>
    </main>
  </div>
</template>
