<script setup>
import { computed, nextTick, ref } from 'vue'

const question = ref('')
const loading = ref(false)
const messageBox = ref(null)
const serviceError = ref('')
const latestDebug = ref(null)
const debugTab = ref('final')
const conversationId = crypto.randomUUID()
const messages = ref([
  { id: 1, role: 'assistant', text: '您好，我是江苏医保智能助手。目前覆盖参保登记与变更、医保关系转移、信息查询、异地就医、费用报销、门诊慢特病、双通道药品、生育待遇和家庭共济等15项业务。请告诉我您的参保城市和想办理的事项。' }
])

const quickQuestions = ['单位给员工办理职工医保需要什么材料？', '没有工作怎么参加居民医保？', '去外省看病如何备案？', '住院没有直接结算怎么报销？', '生孩子医疗费怎么报销？', '怎么给父母办理医保家庭共济？']
const debugCandidates = computed(() => latestDebug.value?.retrievalTrace?.[debugTab.value] || [])
const formatScore = value => Number.isFinite(Number(value)) ? Number(value).toFixed(4) : '—'
const formatMs = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value))}ms` : '—'
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
    latestDebug.value = result.agent || null
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
          <section class="card"><h2>医保 Agent</h2><div class="metric"><span>覆盖地区</span><strong>江苏省</strong></div><div class="metric"><span>核心事项</span><strong>15 项</strong></div><div class="metric"><span>知识资料</span><strong>48份 / 509片段</strong></div><div class="metric"><span>检索方式</span><strong>混合 RAG</strong></div></section>
          <section class="card trace-card">
            <div class="trace-title"><h2>RAG 检索过程</h2><span v-if="latestDebug" class="trace-state">实时</span></div>
            <p v-if="!latestDebug" class="empty-debug">发送一个问题后，这里会显示召回、融合和精排过程。</p>
            <template v-else>
              <div class="debug-meta"><span>意图</span><strong>{{ latestDebug.intent }}</strong></div>
              <div class="debug-meta"><span>置信度</span><strong>{{ formatScore(latestDebug.confidence) }}</strong></div>
              <div class="debug-meta"><span>Reranker</span><strong :class="{ success: latestDebug.reranker?.applied }">{{ latestDebug.reranker?.applied ? '已精排' : 'RRF回退' }}</strong></div>
              <div v-if="Object.keys(latestDebug.slots || {}).length" class="slot-list"><span v-for="(value, key) in latestDebug.slots" :key="key">{{ key }}：{{ value }}</span></div>
              <div class="timings" v-if="latestDebug.retrievalTrace?.timings">
                <span>Embedding {{ formatMs(latestDebug.retrievalTrace.timings.embeddingMs) }}</span>
                <span>关键词 {{ formatMs(latestDebug.retrievalTrace.timings.keywordMs) }}</span>
                <span>向量 {{ formatMs(latestDebug.retrievalTrace.timings.vectorMs) }}</span>
                <span>Rerank {{ formatMs(latestDebug.retrievalTrace.reranker?.durationMs) }}</span>
              </div>
              <div class="trace-tabs">
                <button v-for="tab in [{id:'keyword',label:'关键词'},{id:'vector',label:'向量'},{id:'rrf',label:'RRF'},{id:'final',label:'最终'}]" :key="tab.id" :class="{ active: debugTab === tab.id }" @click="debugTab = tab.id">{{ tab.label }}</button>
              </div>
              <ol class="candidate-list">
                <li v-for="item in debugCandidates" :key="`${debugTab}-${item.chunkId}`">
                  <div><strong>{{ item.title }}</strong><span>#{{ item.chunkId }} · {{ item.sectionTitle || '正文' }}</span></div>
                  <small v-if="debugTab === 'keyword'">关键词分 {{ formatScore(item.keywordScore ?? item.score) }}</small>
                  <small v-else-if="debugTab === 'vector'">向量分 {{ formatScore(item.vectorScore ?? item.score) }}</small>
                  <small v-else-if="debugTab === 'rrf'">RRF {{ formatScore(item.score) }} · K{{ item.keywordRank || '—' }}/V{{ item.vectorRank || '—' }}</small>
                  <small v-else>模型 {{ formatScore(item.rerankScore) }} · 综合 {{ formatScore(item.rerankFinalScore) }} · RRF {{ formatScore(item.rrfScore) }}</small>
                </li>
              </ol>
            </template>
          </section>
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

.trace-card { max-height: 620px; overflow: auto; }
.trace-title { display: flex; align-items: center; justify-content: space-between; }
.trace-state { padding: 2px 7px; border-radius: 999px; background: #dff3ed; color: #168465; font-size: 11px; }
.empty-debug { margin: 0; color: #7b899b; font-size: 12px; line-height: 1.6; }
.debug-meta { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 12px; }
.debug-meta span { color: #66758a; }
.debug-meta strong { text-align: right; overflow-wrap: anywhere; }
.debug-meta .success { color: #168465; }
.slot-list { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
.slot-list span { padding: 4px 7px; border-radius: 7px; background: #edf5ff; color: #285b98; font-size: 10px; }
.timings { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin: 10px 0; }
.timings span { padding: 6px; border-radius: 7px; background: #f4f7fb; color: #52657d; font-size: 10px; }
.trace-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 12px 0 8px; }
.trace-tabs button { border: 1px solid #dfe7f1; border-radius: 7px; padding: 6px 2px; background: #fff; color: #52657d; font-size: 10px; cursor: pointer; }
.trace-tabs button.active { border-color: #145dbf; background: #145dbf; color: #fff; }
.candidate-list { margin: 0; padding-left: 25px; display: grid; gap: 7px; }
.candidate-list li { padding: 7px 7px 7px 2px; border-bottom: 1px solid #edf1f6; font-size: 11px; }
.candidate-list li div { display: grid; gap: 2px; }
.candidate-list li strong { line-height: 1.35; }
.candidate-list li span,.candidate-list li small { color: #718096; font-size: 10px; }
</style>
