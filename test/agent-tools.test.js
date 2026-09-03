import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadKnowledge } from '../server/knowledge.js'
import {
  agentToolDefinitions,
  assess_evidence,
  check_required_slots,
  classify_intent,
  extract_slots,
  generate_material_checklist,
  get_service_guide,
  runAgentTools,
  search_policy,
  update_session_state
} from '../server/agent-tools.js'

const documents = await loadKnowledge(resolve('knowledge/documents'))

test('registers the eight expected agent tools', () => {
  assert.deepEqual(agentToolDefinitions.sort(), [
    'assess_evidence',
    'check_required_slots',
    'classify_intent',
    'extract_slots',
    'generate_material_checklist',
    'get_service_guide',
    'search_policy',
    'update_session_state'
  ])
})

test('classifies cross-region medical intent', () => {
  assert.equal(classify_intent({ message: '南京医保去上海住院怎么办' }).intent, 'cross_region_medical_filing')
})

test('rejects an explicit non-medical-insurance request instead of carrying previous intent', () => {
  assert.equal(classify_intent({ message: '我想办理营业执照', previousIntent: 'cross_region_medical_filing' }).intent, 'out_of_scope')
})

test('classifies family mutual aid and extracts the relative', () => {
  assert.equal(classify_intent({ message: '怎么把医保个人账户共济给妈妈使用' }).intent, 'medical_family_mutual_aid')
  assert.equal(extract_slots({ message: '我想给妈妈绑定家庭共济' }).family_relationship, '父母')
})

test('extracts medical slots from conversational context', () => {
  const slots = extract_slots({
    message: '我是医院转诊过去的，现在正在住院，还没有出院。',
    history: [{ role: 'user', content: '我参加的是南京职工医保，准备去上海住院。' }]
  })
  assert.equal(slots.insured_city, '南京')
  assert.equal(slots.medical_city, '上海')
  assert.equal(slots.insurance_type, '职工医保')
  assert.equal(slots.person_type, '异地转诊人员')
  assert.equal(slots.discharged, false)
})

test('checks missing slots and creates a targeted next question', () => {
  const result = check_required_slots({ intent: 'cross_region_medical_filing', slots: { insured_city: '南京' } })
  assert.equal(result.complete, false)
  assert.equal(result.missing[0], 'medical_city')
  assert.match(result.nextQuestion, /哪个城市/)
})

test('updates state without losing previous slots', () => {
  const conversationId = 'test-state-0001'
  update_session_state({ conversationId, intentResult: { intent: 'cross_region_medical_filing', confidence: 0.9 }, slots: { insured_city: '南京' } })
  const state = update_session_state({ conversationId, intentResult: { intent: 'cross_region_medical_filing', confidence: 0.8 }, slots: { medical_city: '上海' } })
  assert.deepEqual(state.slots, { insured_city: '南京', medical_city: '上海' })
})

test('searches policy and loads the structured guide', async () => {
  const policies = await search_policy({ documents, query: '跨省异地住院备案' })
  assert.equal(policies[0].documentId, '10-cross-region-medical.md')
  assert.equal(get_service_guide({ documents, intent: 'cross_region_medical_filing' })?.filename, '10-cross-region-medical.md')
})

test('prefers database retrieval when the vector store is available', async () => {
  const databaseResult = [{ documentId: 'db-policy', title: '数据库政策', body: '数据库片段', source: 'https://example.gov.cn' }]
  const policies = await search_policy({
    documents,
    query: '异地就医',
    databaseSearch: async (_query, options) => {
      assert.equal(options.intent, null)
      return databaseResult
    }
  })
  assert.deepEqual(policies, databaseResult)
})

test('reranks a wider candidate set after database retrieval', async () => {
  const databaseResult = [
    { documentId: 'rrf-first', title: '初始第一', body: '一般内容' },
    { documentId: 'rerank-first', title: '精排第一', body: '与问题直接相关' }
  ]
  const policies = await search_policy({
    documents,
    query: '目标问题',
    limit: 1,
    databaseSearch: async (_query, options) => {
      assert.equal(options.limit, 10)
      return databaseResult
    },
    rerank: async (_query, candidates, options) => {
      assert.equal(candidates.length, 2)
      assert.equal(options.topN, 1)
      return [{ ...candidates[1], rerankScore: 0.9 }]
    }
  })
  assert.equal(policies[0].documentId, 'rerank-first')
})

test('assesses evidence and generates a personalized checklist', () => {
  const guide = get_service_guide({ documents, intent: 'cross_region_medical_filing' })
  const slots = { insured_city: '南京', medical_city: '上海', person_type: '异地转诊人员', discharged: false }
  assert.equal(assess_evidence({ intent: 'cross_region_medical_filing', guide, slots }).nextAction, 'answer')
  assert.ok(generate_material_checklist({ intent: 'cross_region_medical_filing', slots }).items.some(item => item.includes('转诊转院材料')))
})

test('runs all eight tools as one turn and keeps context on the next turn', async () => {
  const conversationId = 'test-loop-0001'
  await runAgentTools({ conversationId, message: '我准备去外省住院看病', history: [], documents })
  const result = await runAgentTools({
    conversationId,
    message: '我参加的是南京职工医保，准备去上海住院。',
    history: [{ role: 'user', content: '我准备去外省住院看病' }],
    documents
  })
  assert.equal(result.state.intent, 'cross_region_medical_filing')
  assert.equal(result.state.slots.insured_city, '南京')
  assert.equal(result.state.slots.medical_city, '上海')
  assert.equal(result.trace.length, 8)
})
