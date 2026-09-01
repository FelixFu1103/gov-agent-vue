<script setup>
import { nextTick, ref } from 'vue'

const question = ref('')
const loading = ref(false)
const messageBox = ref(null)
const messages = ref([
  { id: 1, role: 'assistant', text: '您好，我是政务服务智能助手。您可以咨询社保、公积金、户籍、企业开办等事项。请告诉我您想办理什么业务？' }
])

const quickQuestions = ['办理营业执照需要什么材料？', '社保转移如何办理？', '异地身份证到期怎么换领？', '公积金提取有哪些条件？']
const knowledge = [
  { keys: ['营业执照', '企业', '公司'], text: '办理企业营业执照通常需要准备企业名称、经营场所信息、经营范围，以及股东和法定代表人身份信息。不同地区和企业类型的具体材料可能不同。正式上线后，我会根据您所在地区继续追问并引用当地办事指南。', source: '示例来源：《企业开办办事指南》（待接入正式文件）' },
  { keys: ['社保', '养老', '转移'], text: '社保转移通常需要先确认转入地参保状态，再通过线上政务平台或社保经办窗口申请。办理条件和所需材料会因地区及险种而异，请提供所在城市和需要转移的险种。', source: '示例来源：《社会保险关系转移接续指南》（待核验）' },
  { keys: ['身份证', '户籍'], text: '居民身份证到期换领一般可在户籍地办理，部分地区也支持异地受理。通常需要原居民身份证，并按现场要求采集照片和指纹。请告诉我您目前所在城市，以便匹配当地规定。', source: '示例来源：《居民身份证异地受理工作规定》（待接入当地细则）' },
  { keys: ['公积金'], text: '住房公积金提取常见情形包括购房、租房、偿还住房贷款和退休等。每种情形的额度、频次及材料不同。您属于哪一种提取情形？', source: '示例来源：《住房公积金提取管理办法》（待接入当地版本）' }
]

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
  await scrollToBottom()

  // 正式接入时，将这里替换为 fetch('/api/chat', { ... })。
  window.setTimeout(async () => {
    const hit = knowledge.find(item => item.keys.some(key => value.includes(key)))
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      text: hit?.text ?? '目前的示例知识库还没有覆盖这个问题。正式版本会优先检索权威文件；没有可靠依据时将明确提示并建议转人工，不会编造答案。',
      source: hit?.source ?? '处理结果：未找到可靠来源'
    })
    loading.value = false
    await scrollToBottom()
  }, 650)
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
      <div class="notice">演示版本：当前回答来自示例知识库，不构成正式办事依据。正式上线需接入本地区权威政策文件。</div>

      <div class="workspace">
        <section class="chat" aria-label="智能咨询对话">
          <header class="chat-head"><strong>智能助手</strong><span>回答将标注信息来源</span></header>
          <div ref="messageBox" class="messages" aria-live="polite">
            <div v-for="message in messages" :key="message.id" class="row" :class="{ user: message.role === 'user' }">
              <div class="avatar">{{ message.role === 'user' ? '我' : '政' }}</div>
              <div class="bubble"><p>{{ message.text }}</p><div v-if="message.source" class="source">{{ message.source }}</div></div>
            </div>
            <div v-if="loading" class="row"><div class="avatar">政</div><div class="bubble typing">正在检索示例知识库…</div></div>
          </div>
          <form class="composer" @submit.prevent="ask()">
            <div class="input-wrap"><textarea v-model="question" rows="2" placeholder="例如：办理营业执照需要哪些材料？" aria-label="输入政务咨询问题" @keydown="handleKeydown"></textarea><button :disabled="loading || !question.trim()" type="submit">发送</button></div>
            <p class="hint">按 Enter 发送，Shift + Enter 换行 · AI 回答可能有误，请以办事部门最新规定为准</p>
          </form>
        </section>

        <aside class="panel">
          <section class="card"><h2>常见问题</h2><div class="quick"><button v-for="item in quickQuestions" :key="item" @click="ask(item)">{{ item }}</button></div></section>
          <section class="card"><h2>知识库概况</h2><div class="metric"><span>政策文件</span><strong>演示 12 份</strong></div><div class="metric"><span>更新时间</span><strong>待接入</strong></div><div class="metric"><span>回答模式</span><strong>来源优先</strong></div></section>
        </aside>
      </div>
    </main>
  </div>
</template>
