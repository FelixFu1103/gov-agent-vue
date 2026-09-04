<script setup>
import { nextTick, ref } from 'vue'

const question = ref('')
const loading = ref(false)
const messageBox = ref(null)
const serviceError = ref('')
const conversationId = crypto.randomUUID()
const messages = ref([
  { id: 1, role: 'assistant', text: '您好，我是江苏医保智能助手。目前覆盖参保登记与变更、医保关系转移、信息查询、异地就医、费用报销、门诊慢特病、双通道药品、生育待遇和家庭共济等15项业务。请告诉我您的参保城市和想办理的事项。' }
])

const quickQuestions = ['单位给员工办理职工医保需要什么材料？', '没有工作怎么参加居民医保？', '去外省看病如何备案？', '住院没有直接结算怎么报销？', '生孩子医疗费怎么报销？', '怎么给父母办理医保家庭共济？']
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
      body: JSON.stringify({ message: value, history, conversationId })
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'AI 服务暂时不可用')
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      text: result.answer,
      sources: result.sources || [],
      source: result.sources?.length ? '' : `AI 回答 · ${result.model || 'DeepSeek'} · 知识库未命中`
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
      <div class="brand"><div class="emblem">医</div><div><strong>江苏医保 Agent</strong><small>Jiangsu Medical Insurance AI</small></div></div>
      <div class="side-title">医保服务</div>
      <nav class="nav"><button class="active">医保咨询</button><button>支持事项</button><button>政策依据</button><button>咨询记录</button></nav>
      <div class="safe"><strong>隐私提示</strong>请勿在对话中发送身份证号、银行卡号、密码等敏感信息。</div>
    </aside>

    <main>
      <header class="top"><div><h1>江苏医保智能咨询</h1><p>识别办理事项，结合上下文检索官方医保资料</p></div><div class="status"><i></i>医保服务正常</div></header>
      <div class="notice">当前覆盖15项江苏医保高频业务。政策和各市执行口径可能调整，具体办理以参保地医保部门最新规定为准。</div>

      <div class="workspace">
        <section class="chat" aria-label="智能咨询对话">
          <header class="chat-head"><strong>智能助手</strong><span>{{ serviceError ? '服务需要检查' : 'DeepSeek API' }}</span></header>
          <div ref="messageBox" class="messages" aria-live="polite">
            <div v-for="message in messages" :key="message.id" class="row" :class="{ user: message.role === 'user' }">
              <div class="avatar">{{ message.role === 'user' ? '我' : '医' }}</div>
              <div class="bubble"><p>{{ message.text }}</p><div v-if="message.sources?.length" class="source"><span v-for="(item, index) in message.sources" :key="item.chunkId || `${item.url}-${index}`">{{ index ? '；' : '官方依据：' }}[资料{{ index + 1 }}] <a :href="item.url" target="_blank" rel="noopener noreferrer">{{ item.title }} · {{ item.sectionTitle }}（网页原文）</a><template v-if="item.documentUrl"> · <a :href="item.documentUrl" target="_blank" rel="noopener noreferrer">PDF原文</a></template></span></div><div v-else-if="message.source" class="source">{{ message.source }}</div></div>
            </div>
            <div v-if="loading" class="row"><div class="avatar">医</div><div class="bubble typing">正在检索江苏医保资料并整理回答…</div></div>
          </div>
          <form class="composer" @submit.prevent="ask()">
            <div class="input-wrap"><textarea v-model="question" rows="2" placeholder="例如：南京职工医保去上海住院如何备案？" aria-label="输入江苏医保咨询问题" @keydown="handleKeydown"></textarea><button :disabled="loading || !question.trim()" type="submit">发送</button></div>
            <p class="hint">按 Enter 发送，Shift + Enter 换行 · 请勿发送身份证号等敏感信息 · 以参保地医保部门最新规定为准</p>
          </form>
        </section>

        <aside class="panel">
          <section class="card"><h2>常见问题</h2><div class="quick"><button v-for="item in quickQuestions" :key="item" @click="ask(item)">{{ item }}</button></div></section>
          <section class="card"><h2>医保 Agent</h2><div class="metric"><span>覆盖地区</span><strong>江苏省</strong></div><div class="metric"><span>核心事项</span><strong>15 项</strong></div><div class="metric"><span>知识资料</span><strong>医保 15 份</strong></div><div class="metric"><span>检索方式</span><strong>混合 RAG</strong></div></section>
        </aside>
      </div>
    </main>
  </div>
</template>

<style>
.bubble p {
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.source {
  line-height: 1.65;
}

.source a {
  color: #145dbf;
  text-decoration: none;
}

.source a:hover {
  text-decoration: underline;
}
</style>
