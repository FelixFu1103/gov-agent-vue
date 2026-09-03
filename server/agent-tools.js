import { buildRetrievalQuery, searchKnowledge } from './knowledge.js'

const intentDefinitions = {
  medical_employee_enrollment: {
    label: '职工基本医疗保险参保登记',
    filename: '09-medical-enrollment.md',
    requiredSlots: ['insured_city', 'applicant_type']
  },
  medical_resident_enrollment: {
    label: '城乡居民基本医疗保险参保登记',
    filename: '31-resident-medical-enrollment.md',
    requiredSlots: ['insured_city', 'applicant_type']
  },
  cross_region_medical_filing: {
    label: '异地就医备案',
    filename: '10-cross-region-medical.md',
    requiredSlots: ['insured_city', 'medical_city', 'person_type', 'discharged']
  },
  medical_expense_reimbursement: {
    label: '医疗费用手工（零星）报销',
    filename: '11-medical-reimbursement.md',
    requiredSlots: ['insured_city', 'insurance_type', 'expense_type']
  },
  maternity_medical_payment: {
    label: '生育医疗费支付',
    filename: '32-maternity-medical-expense.md',
    requiredSlots: ['insured_city', 'applicant_type', 'expense_type']
  }
}

const sessionStore = new Map()
const sessionTtlMs = 30 * 60 * 1000

function includesAny(text, terms) {
  return terms.some(term => text.includes(term))
}

function cleanCity(value) {
  return value?.replace(/^(江苏省|江苏)/, '').replace(/市$/, '') || undefined
}

export function classify_intent({ message, previousIntent }) {
  const text = message.replace(/\s+/g, '')
  const candidates = []
  const add = (intent, score) => candidates.push({ intent, score })
  const explicitlyOutsideScope = includesAny(text, ['公积金', '身份证', '户口', '户籍', '营业执照', '企业开办', '结婚登记', '驾驶证', '养老保险', '失业保险', '工伤认定'])
  const reimbursementSignal = includesAny(text, ['报销', '零星报销', '手工报销', '现金垫付', '没有直接结算', '未直接结算', '费用未结算', '发票', '费用清单'])
  const maternitySignal = includesAny(text, ['生育', '生孩子', '分娩', '产检'])
  const crossRegionSignal = includesAny(text, ['备案', '跨省', '外省', '异地就医', '异地安置', '常驻异地', '异地工作', '转诊']) || /(去|到|在).{2,8}(看病|就医|住院)/.test(text)
  const residentSignal = includesAny(text, ['居民医保', '居民医疗保险', '城乡医保', '城乡居民', '学生医保', '农村居民']) || (includesAny(text, ['居民', '学生', '无业', '没有工作', '没有单位']) && includesAny(text, ['医保', '医疗保险', '参保']))
  const employeeSignal = includesAny(text, ['职工医保', '员工医保', '单位参保', '灵活就业', '自由职业']) || (includesAny(text, ['公司', '企业', '单位', '员工', '职工', '入职']) && includesAny(text, ['医保', '医疗保险', '参保']))

  if (maternitySignal && includesAny(text, ['费', '报销', '支付', '医保', '保险', '材料', '申请', '提交'])) add('maternity_medical_payment', 0.98)
  if (reimbursementSignal) add('medical_expense_reimbursement', maternitySignal ? 0.86 : 0.96)
  if (crossRegionSignal) add('cross_region_medical_filing', reimbursementSignal ? 0.9 : 0.95)
  if (residentSignal) add('medical_resident_enrollment', reimbursementSignal ? 0.84 : 0.94)
  if (employeeSignal && includesAny(text, ['参保', '参加', '登记', '办理', '怎么交', '材料', '证件', '开户', '新增', '指南'])) add('medical_employee_enrollment', reimbursementSignal ? 0.82 : 0.93)
  candidates.sort((a, b) => b.score - a.score)
  if (!candidates.length && explicitlyOutsideScope) return { intent: 'out_of_scope', confidence: 0.99, alternatives: [] }
  if (!candidates.length && previousIntent) candidates.push({ intent: previousIntent, score: 0.72 })
  return {
    intent: candidates[0]?.intent || 'unknown',
    confidence: candidates[0]?.score || 0,
    alternatives: candidates.slice(1, 3).map(item => item.intent)
  }
}

export function extract_slots({ message, history = [], existingSlots = {} }) {
  const context = [...history.filter(item => item.role === 'user').map(item => item.content), message].join('；')
  const current = message.replace(/\s+/g, '')
  const slots = { ...existingSlots }

  const insuredPattern = /(?:参加(?:的)?是|参保地(?:是|在)?|参加|缴纳)(?:江苏省?)?([\u4e00-\u9fa5]{2,8}?)(?:市)?(?:的)?(?:职工|居民|城乡居民)?医保/
  const insuredMatch = current.match(insuredPattern) || context.match(insuredPattern)
  if (insuredMatch) slots.insured_city = cleanCity(insuredMatch[1])

  const medicalPattern = /(?:准备|打算|已经|目前|要)?(?:去|到|在)(?:江苏省?)?([\u4e00-\u9fa5]{2,8}?)(?:市)?(?:的)?(?:医院)?(?:看病|就医|住院|治疗)/
  const invalidCities = ['外省', '外地', '异地', '正在', '已经', '目前']
  const medicalCity = [current, ...history.filter(item => item.role === 'user').slice().reverse().map(item => item.content.replace(/\s+/g, ''))]
    .map(text => cleanCity(text.match(medicalPattern)?.[1]))
    .find(city => city && !invalidCities.includes(city))
  if (medicalCity) slots.medical_city = medicalCity

  if (includesAny(context, ['职工医保', '员工医保'])) slots.insurance_type = '职工医保'
  else if (includesAny(context, ['居民医保', '城乡医保', '学生医保'])) slots.insurance_type = '城乡居民医保'

  if (includesAny(context, ['医院转诊', '转诊过去', '转诊人员', '转诊转院'])) slots.person_type = '异地转诊人员'
  else if (includesAny(context, ['长期居住', '长期住在', '定居外地'])) slots.person_type = '异地长期居住人员'
  else if (includesAny(context, ['常驻异地', '外派工作', '异地工作'])) slots.person_type = '常驻异地工作人员'
  else if (includesAny(context, ['临时外出', '旅游', '出差'])) slots.person_type = '其他临时外出就医人员'
  else if (includesAny(context, ['异地安置退休', '退休后住'])) slots.person_type = '异地安置退休人员'

  if (includesAny(context, ['已经出院', '办完出院', '出院了'])) slots.discharged = true
  else if (includesAny(context, ['尚未出院', '还没出院', '目前已住院', '正在住院', '准备住院'])) slots.discharged = false
  if (includesAny(context, ['已经住院', '目前已住院', '正在住院'])) slots.hospitalized = true
  else if (includesAny(context, ['准备住院', '打算住院'])) slots.hospitalized = false

  if (includesAny(current, ['单位', '公司', '员工'])) slots.applicant_type = '用人单位或单位职工'
  else if (includesAny(current, ['灵活就业', '个人参保'])) slots.applicant_type = '灵活就业人员'
  else if (includesAny(current, ['居民', '学生', '没有工作', '无工作'])) slots.applicant_type = '城乡居民'
  else if (includesAny(current, ['女职工', '本人怀孕', '我生育'])) slots.applicant_type = '参保女职工'
  else if (includesAny(current, ['男职工', '妻子', '配偶'])) slots.applicant_type = '男职工未就业配偶相关申请'

  if (includesAny(current, ['门诊'])) slots.expense_type = '门诊费用'
  else if (includesAny(current, ['住院'])) slots.expense_type = '住院费用'
  else if (includesAny(current, ['产检'])) slots.expense_type = '产前检查费'
  else if (includesAny(current, ['生育', '生孩子', '分娩'])) slots.expense_type = '生育医疗费'
  return slots
}

export function check_required_slots({ intent, slots }) {
  const required = intentDefinitions[intent]?.requiredSlots || []
  const missing = required.filter(name => slots[name] === undefined)
  const questions = {
    insured_city: '您的医保参保城市是哪里？',
    medical_city: '您准备在哪个城市就医？',
    person_type: '您属于医院转诊、长期异地居住、常驻异地工作，还是临时外出就医？',
    discharged: '您现在是准备住院、正在住院，还是已经出院？',
    insurance_type: '您参加的是职工医保还是城乡居民医保？',
    expense_type: '您咨询的是门诊、住院、产检还是生育医疗费用？',
    applicant_type: '您是单位职工、灵活就业人员、城乡居民，还是为配偶咨询？'
  }
  return { complete: missing.length === 0, missing, nextQuestion: questions[missing[0]] || null }
}

export function update_session_state({ conversationId, intentResult, slots }) {
  const previous = sessionStore.get(conversationId) || {}
  const state = {
    intent: intentResult.intent === 'unknown' ? previous.intent : intentResult.intent,
    confidence: intentResult.confidence,
    slots: { ...(previous.slots || {}), ...slots },
    updatedAt: Date.now()
  }
  sessionStore.set(conversationId, state)
  return state
}

export function getSessionState(conversationId) {
  const state = sessionStore.get(conversationId)
  if (state && Date.now() - state.updatedAt > sessionTtlMs) {
    sessionStore.delete(conversationId)
    return null
  }
  return state || null
}

export async function search_policy({ documents, query, limit = 3, intent, slots = {}, databaseSearch }) {
  if (databaseSearch) {
    const results = await databaseSearch(query, { limit, intent: !intent || intent === 'unknown' ? null : intent, region: slots.insured_city || null })
    if (results.length) return results
  }
  return searchKnowledge(documents, query, limit).map(document => ({
    documentId: document.filename,
    title: document.title,
    department: document.department,
    region: document.region,
    verifiedAt: document.verified_at,
    versionNote: document.version_note,
    source: document.source,
    sourceDocument: document.source_document,
    body: document.body
  }))
}

export function get_service_guide({ documents, intent }) {
  const definition = intentDefinitions[intent]
  if (!definition) return null
  return documents.find(document => document.filename === definition.filename) || null
}

export function assess_evidence({ intent, guide, slots }) {
  const slotCheck = check_required_slots({ intent, slots })
  if (!guide) return { sufficient: false, reason: '知识库没有对应办事指南', nextAction: 'transfer_to_human' }
  const stale = !guide.verified_at || Date.now() - Date.parse(guide.verified_at) > 365 * 24 * 60 * 60 * 1000
  if (stale) return { sufficient: false, reason: '资料超过一年未核验', nextAction: 'check_policy_version' }
  if (!slotCheck.complete) return { sufficient: true, reason: '省级通用规则可回答，但个性化判断仍缺少信息', nextAction: 'ask_user', nextQuestion: slotCheck.nextQuestion }
  return { sufficient: true, reason: '事项、资料和必要信息完整', nextAction: 'answer' }
}

export function generate_material_checklist({ intent, slots }) {
  const commonId = '医保电子凭证、有效身份证件或社会保障卡'
  const lists = {
    medical_employee_enrollment: slots.applicant_type === '灵活就业人员'
      ? [commonId, '参保地要求的其他身份或就业材料']
      : ['《职工基本医疗保险参保登记表》', '特殊人群相应证明材料（如适用）'],
    medical_resident_enrollment: [commonId, '数据共享无法核验时所需的户籍、学籍、居住或身份材料'],
    cross_region_medical_filing: [commonId, {
      异地转诊人员: '定点医疗机构出具的转诊转院材料',
      异地长期居住人员: '长期居住认定材料或个人承诺书',
      常驻异地工作人员: '派出证明、异地工作证明、工作合同之一或个人承诺书',
      异地安置退休人员: '异地户籍材料或个人承诺书',
      其他临时外出就医人员: '有效身份证明'
    }[slots.person_type] || '根据备案人员类别准备对应证明或承诺书'],
    medical_expense_reimbursement: slots.expense_type === '门诊费用'
      ? [commonId, '医院收费票据', '门急诊费用清单', '处方底方或病历资料']
      : [commonId, '医院收费票据', '住院费用清单', '诊断证明或出院小结'],
    maternity_medical_payment: [commonId, '医院收费票据', '费用清单', '门诊病历或出院小结等病历资料']
  }
  return { intent, items: lists[intent] || [], note: '特殊情形可能需要补充材料，以参保地一次性告知为准。' }
}

export async function runAgentTools({ conversationId, message, history, documents, databaseSearch }) {
  const previous = getSessionState(conversationId)
  const intentResult = classify_intent({ message, previousIntent: previous?.intent })
  const slots = extract_slots({ message, history, existingSlots: previous?.slots })
  const state = update_session_state({ conversationId, intentResult, slots })
  const slotCheck = check_required_slots({ intent: state.intent, slots: state.slots })
  const query = buildRetrievalQuery(history, message)
  const policies = await search_policy({ documents, query, intent: state.intent, slots: state.slots, databaseSearch })
  const guide = get_service_guide({ documents, intent: state.intent })
  const evidence = assess_evidence({ intent: state.intent, guide, slots: state.slots })
  const checklist = generate_material_checklist({ intent: state.intent, slots: state.slots })
  return {
    state,
    slotCheck,
    policies,
    guide,
    evidence,
    checklist,
    trace: ['classify_intent', 'extract_slots', 'update_session_state', 'check_required_slots', 'search_policy', 'get_service_guide', 'assess_evidence', 'generate_material_checklist']
  }
}

export const agentToolDefinitions = Object.keys({ classify_intent, extract_slots, check_required_slots, update_session_state, search_policy, get_service_guide, assess_evidence, generate_material_checklist })
