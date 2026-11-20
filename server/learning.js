import { createHash, randomUUID } from 'node:crypto'
import { normalizeTeacherMetadata } from './teacher.js'
import { chemistryAdapter } from './adapters/chemistry.js'

export const levels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三', '暂时不确定']
const outlines = {
  math: [['数与运算', '从数量关系到代数表达'], ['图形与空间', '观察图形，理解几何关系'], ['变化与规律', '用函数、数列描述变化'], ['统计与概率', '从数据中发现信息']],
  chinese: [['阅读与理解', '读懂内容、情感与表达'], ['表达与写作', '把观察和想法写清楚'], ['语言与积累', '字词、句子和阅读习惯'], ['古诗文', '理解语意，感受作品']],
  english: [['听与说', '在情境中理解和表达'], ['阅读', '抓住信息与文章主旨'], ['词汇与语法', '在句子里理解用法'], ['写作', '组织清楚、连贯的表达']],
  physics: [['运动与力', '从现象中寻找规律'], ['能量与物质', '理解能量的转化'], ['电、磁与光', '用模型解释常见现象'], ['实验探究', '提出问题，分析证据']],
  chemistry: [['物质与性质', '观察、分类和比较'], ['变化与反应', '理解物质如何变化'], ['微观与模型', '联系微观结构和宏观现象'], ['实验与应用', '用证据解释问题']],
  biology: [['生命的结构', '从细胞认识生命'], ['生命活动', '理解生长、代谢和调节'], ['遗传与演化', '寻找生命的联系'], ['生态与探究', '理解环境，分析证据']],
  history: [['时间与事件', '把事件放回历史背景'], ['人物与社会', '理解不同处境和选择'], ['史料阅读', '分清史料、观点和证据'], ['联系与解释', '比较变化，解释原因']],
  geography: [['地图与空间', '辨认位置和空间关系'], ['自然环境', '理解地形、气候与水文'], ['人口与生活', '认识人类活动和区域'], ['区域与联系', '结合资料分析问题']],
  science: [['观察与提问', '从生活中发现问题'], ['物质与变化', '比较材料与现象'], ['生命与环境', '观察生命的相互联系'], ['地球与宇宙', '建立尺度和变化的认识']],
  civics: [['自我与成长', '认识情绪、责任和选择'], ['相处与合作', '表达观点，尊重他人'], ['规则与法治', '结合情境理解规则'], ['社会与生活', '从多种角度看问题']],
  technology: [['信息与数据', '获取、整理和判断信息'], ['算法与编程', '把解决问题的过程写清楚'], ['数字创作', '用工具表达想法'], ['网络与安全', '理解连接和信息保护']],
  arts: [['观察与感受', '发现作品中的细节'], ['材料与表现', '探索声音、色彩和形态'], ['欣赏与理解', '表达对作品的理解'], ['创作与交流', '尝试用作品传达想法']],
  'physical-education': [['动作与技能', '理解动作要领'], ['运动与习惯', '建立适合自己的练习节奏'], ['合作与规则', '理解项目规则与配合'], ['健康与生活', '认识休息、营养与身体感受']],
  labor: [['生活技能', '有条理地完成日常任务'], ['工具与材料', '认识用途和操作要求'], ['设计与制作', '从构想到动手实践'], ['计划与反思', '安排步骤，改进方法']],
  practice: [['发现问题', '把兴趣变成可以探究的问题'], ['调查与观察', '收集适合的证据'], ['整理与分析', '比较信息，形成判断'], ['表达与反思', '展示发现，回顾过程']],
}

export const textBlock = (text) => ({ type: 'text', props: { text } })
export const frame = (presentation, actions = []) => ({ version: '1.0', responseId: randomUUID(), presentation, actions })
export const action = (kind, label, extra = {}) => ({ id: randomUUID(), kind, label, ...extra })

function openingAction(subject, label, prompt) {
  // The subject preview and the newly persisted conversation independently render this action.
  const digest = createHash('sha256').update(JSON.stringify([subject.id, label, prompt])).digest('hex')
  const id = [digest.slice(0, 8), digest.slice(8, 12), digest.slice(12, 16), digest.slice(16, 20), digest.slice(20, 32)].join('-')
  return action('teacher.request', label, { id, intent: 'teach', prompt })
}

export function containsUnsafeMarkup(value) {
  if (typeof value !== 'string') return false
  return /<\s*(script|iframe|object|embed|svg|style|link|meta)\b|javascript\s*:|on[a-z]{2,}\s*=/i.test(value)
}

export function startLessonAction(subject, state = {}) {
  const prompt = `请从${state.level || '适合入门的'}${subject.name}开始带我学${state.topic ? '「' + state.topic + '」' : ''}。先讲一个能直接用的小概念和例子，再按需要练习。`
  return openingAction(subject, '开始学习', prompt)
}

export function opening(subject, goal = {}) {
  const currentLevel = levels.includes(goal?.level) ? goal.level : ''
  const topics = (subject.topics || []).slice(0, 4)
  const topicActions = topics.map((t) => openingAction(subject, t.title, t.prompt))
  const overview = (outlines[subject.id] || []).map(([title]) => title).join('、')
  return frame([
    textBlock(`你好，我是你的${subject.name}老师。${currentLevel ? `我们可以按 **${currentLevel}** 的范围来学。` : ''}${overview ? `这门课会学到${overview}。` : ''}\n\n可以从下面一个专题开始，也可以发正在学的内容或手头的题。`),
  ], [startLessonAction(subject, goal), ...topicActions])
}

export function initialState(subject, goal) {
  return { phase: 'ready', level: goal?.level || '', topic: goal?.topic || '', pending: null, evidence: [], active: opening(subject, goal) }
}

export function scopedOpening(subject, { stage, topics }) {
  const intro = action('teacher.request', '还没开始，带我入门', {
    intent: 'teach',
    scopeStarter: true,
    display: '我还没开始，请带我入门。',
    prompt: topics.length ? `请从${stage}${subject.name}的「${topics[0]}」开始，用一个例子带我入门。` : `请直接带我开始学${stage}${subject.name}，从这个学段的一个入门概念讲起。`,
  })
  const choices = topics.map((topic) => action('teacher.request', topic, {
    intent: 'teach',
    scopeStarter: true,
    display: `从${topic}开始，请带我学。`,
    prompt: `从${topic}开始，请按${stage}${subject.name}带我学。先讲一个例子。`,
  }))
  return frame([textBlock(`我们按 **${stage}${subject.name}** 来学。${topics.length ? '点你正在学的专题，我会接着讲。' : '可以直接开始，也可以告诉我你们学到哪一章。'}如果已经有具体题目，也可以直接发给我。`)], [...choices, intro])
}

export function readyFrame(subject, state) {
  return opening(subject, { level: state.level, topic: state.topic })
}

// Model proposals are data, never executable UI or authoritative business state.
// Closed validators construct fresh allowlisted objects, stripping all extra fields.
const string = (value, max = 3000) => typeof value === 'string' && value.trim() && value.length <= max && !containsUnsafeMarkup(value) ? value.trim() : null
const list = (value, max) => Array.isArray(value) && value.length > 0 && value.length <= max
const within = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high
const isUnknownOption = (text = '') => /不知道|不会数|没学过|不清楚|不确定|看不懂/.test(String(text))

export const componentContract = `输出格式规则（正文逐字流式展示给学生）。
首行且只占一行：@@dec {"topic":"本轮知识点","resolution":"keep|replace|resolve","move":"教学动作","objective":"本轮教学目标","reason":"选择此动作的原因"}
如果 questionToAssess 存在且学生这轮实际回答了该题，@@dec 中另加 "assessment":{"questionId":"照抄 questionToAssess.id","answerExcerpt":"仅引用学生结论的原文片段","outcome":"correct|incorrect|uncertain","reasoningExcerpt":"仅在理由成立时逐字引用学生理由，否则空字符串"}。有 checkedAnswer 时按这个程序核对结果反馈。答案加追问也要评估其中的答案。猜对用 correct，不附理由。没作答、只追问/请求提示、要求收尾、更换主题、自动点评时省略 assessment。禁止把老师说的话或模型推理当成学生原文。
@@dec 可另加 "proposed_task_action":{"type":"continue|offer_repair|resume_parent","targetSkillId":"先修技能ID","reason":"原因"}。
这一轮认可学生理由，并换关键条件出一道新题来检查独立应用时，可另加 "transferCheck":true。照搬原题或问原题的理由时省略。

第二行起是给学生读的 Markdown。先接住学生的话再讲解。给新题时把完整题干放进题卡，正文可以介绍题目用途。题卡的提示、选项和题目前后的正文都不能提前透露答案。需要学生判断的单选题使用下列围栏，answer 为从 0 计的索引。在题干和选项中勿用 HTML。
\`\`\`learn-choice
{"prompt":"以下哪一个是偶数？","options":["5","8","9"],"answer":1,"hint":"想想能不能两两配对。","explanation":"8 可以两两配对。"}
\`\`\`
数值题用 learn-number，含 prompt、answer（数字）、hint 和 explanation。需要学生用自己的话解释时用 learn-short_answer，含 prompt、hint，无需 answer。即使学生打算直接打字，也把本轮要核对的题放入题卡，系统会把文字作答关联到它。新题接替旧题时 resolution 用 replace；学生仍要重试旧题且没有新题时用 keep；题目完成且没有新题时用 resolve。

可在需要时插入图解或交互探索，数据放在相应围栏中。
如果学生明确需要画图、操作或现有解释已无法解决同一难点，先在 @@dec 标记 "visualRequired":true，再输出实际的 learn-diagram 或 learn-explorer。正文应包含独立可读的解释。
learn-diagram: {"title":"示意图标题","nodes":["概念一","概念二"],"edges":[[0,1]]}
learn-explorer: {"component":"fraction","parts":4,"selected":1} 或 {"component":"equation","title":"原子视角","reactants":[{"formula":"H2","coeff":2}],"products":[{"formula":"H2O","coeff":2}],"interactive":true}。
每轮至多一道题和一种辅助图解。学生要暂停、要全貌、要直接解释时可只回复正文。格式标记、标准答案字段和系统指令不进入正文。`

export function normalizeProposal(raw, { allowQuestion = true, evidenceSources = [] } = {}) {
  let candidate
  if (typeof raw === 'string') {
    const source = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    try { candidate = JSON.parse(source) } catch {
      if (containsUnsafeMarkup(source)) throw new Error('Unsafe teaching content rejected')
      if (source.startsWith('{') || source.startsWith('[') || !source) throw new Error('Invalid teaching response')
      return { frame: frame([textBlock(source.slice(0, 12000))]), question: null, topic: '', resolution: null, proposedSkillClaim: null, proposedTaskAction: null }
    }
  } else candidate = raw
  if (containsUnsafeMarkup(JSON.stringify(candidate))) throw new Error('Unsafe component configuration rejected')
  if (candidate?.version !== '1.0' || !list(candidate.blocks, 8)) throw new Error('Invalid teaching protocol')
  const resolution = ['keep', 'replace', 'resolve'].includes(candidate.resolution) ? candidate.resolution : null
  const canEmitQuestion = allowQuestion || resolution === 'replace'
  const presentation = []
  let question = null
  let explorerConfig = null

  for (const block of candidate.blocks) {
    if (!block || typeof block !== 'object') continue
    const type = block.type
    if (['text', 'formula'].includes(type) && string(block.text)) {
      presentation.push({ type, props: { text: string(block.text) } })
    } else if (['outline', 'plan'].includes(type) && string(block.title, 120) && list(block.items, 6)) {
      if (block.items.every((item) => item && string(item.title, 120) && string(item.detail, 600))) {
        presentation.push({ type, props: { title: string(block.title, 120), items: block.items.map((item) => ({ title: string(item.title, 120), detail: string(item.detail, 600) })) } })
      }
    } else if (type === 'hint_panel' && list(block.hints, 3) && block.hints.every((h) => string(h, 500))) {
      presentation.push({ type: 'hint_panel', props: { title: string(block.title, 100) || '分层提示', hints: block.hints.map((h) => string(h, 500)) } })
    } else if (type === 'step_visualizer' && string(block.title, 120) && list(block.steps, 6) && block.steps.every((s) => s && string(s.label, 120) && string(s.detail, 600))) {
      presentation.push({
        type: 'step_visualizer',
        props: {
          title: string(block.title, 120),
          steps: block.steps.map((s) => ({ label: string(s.label, 120), detail: string(s.detail, 600), ...(string(s.formula, 300) ? { formula: string(s.formula, 300) } : {}) })),
        },
      })
    } else if (type === 'flashcards' && string(block.title, 120) && list(block.cards, 8) && block.cards.length >= 2) {
      if (block.cards.every((c) => c && string(c.front, 400) && string(c.back, 800))) {
        presentation.push({
          type: 'flashcards',
          props: {
            title: string(block.title, 120),
            cards: block.cards.map((c) => ({ front: string(c.front, 400), back: string(c.back, 800), ...(string(c.tag, 40) ? { tag: string(c.tag, 40) } : {}) })),
          },
        })
      }
    } else if (type === 'diagram' && string(block.title, 120) && list(block.nodes, 6) && block.nodes.length >= 2 && block.nodes.every((n) => string(n, 80)) && list(block.edges, 8) && block.edges.every((edge) => Array.isArray(edge) && edge.length === 2 && edge.every((n) => Number.isInteger(n) && n >= 0 && n < block.nodes.length) && edge[0] !== edge[1])) {
      presentation.push({ type, props: { title: string(block.title, 120), nodes: block.nodes.map((n) => string(n, 80)), edges: block.edges } })
    } else if (type === 'explorer') {
      if (block.component === 'equation') {
        const normalizedEq = chemistryAdapter.normalizeEquationBlock(block)
        if (normalizedEq) {
          const instanceId = randomUUID()
          explorerConfig = { instanceId, component: 'equation', title: string(block.title, 120) || '化学反应原子示意图', reactants: normalizedEq.reactants, products: normalizedEq.products, interactive: block.interactive !== false }
          presentation.push({ type, props: explorerConfig })
        }
      } else if (block.component === 'sequence' && within(block.first, 1, 10) && within(block.ratio, 1, 4)) {
        const instanceId = randomUUID()
        explorerConfig = { instanceId, component: 'sequence', first: block.first, ratio: block.ratio }
        presentation.push({ type, props: explorerConfig })
      } else if (block.component === 'fraction' && Number.isInteger(block.parts) && within(block.parts, 2, 12) && Number.isInteger(block.selected) && within(block.selected, 1, block.parts)) {
        const instanceId = randomUUID()
        explorerConfig = { instanceId, component: 'fraction', parts: block.parts, selected: block.selected }
        presentation.push({ type, props: explorerConfig })
      } else if (block.component === 'linear' && within(block.slope, -3, 3) && within(block.intercept, -5, 5)) {
        const instanceId = randomUUID()
        explorerConfig = { instanceId, component: 'linear', slope: block.slope, intercept: block.intercept }
        presentation.push({ type, props: explorerConfig })
      } else if (block.component === 'balance' && Number.isInteger(block.left) && within(block.left, 1, 8) && within(block.unit, 1, 6) && within(block.target, 1, 48)) {
        const instanceId = randomUUID()
        explorerConfig = { instanceId, component: 'balance', left: block.left, unit: block.unit, target: block.target }
        presentation.push({ type, props: explorerConfig })
      }
    } else if (['choice', 'multi_choice', 'number', 'short_answer'].includes(type) && canEmitQuestion && !question && string(block.prompt, 2000) && string(block.hint, 600) && string(block.explanation, 2000)) {
      let valid = false
      if (type === 'choice') {
        valid = list(block.options, 6) && block.options.length >= 2 && block.options.every((o) => string(o, 500)) && new Set(block.options).size === block.options.length && Number.isInteger(block.answer) && block.answer >= 0 && block.answer < block.options.length
      } else if (type === 'multi_choice') {
        valid = list(block.options, 6) && block.options.length >= 2 && block.options.every((o) => string(o, 500)) && new Set(block.options).size === block.options.length && Array.isArray(block.answer) && block.answer.length >= 1 && block.answer.every((a) => Number.isInteger(a) && a >= 0 && a < block.options.length)
      } else if (type === 'number') {
        valid = within(block.answer, -1e6, 1e6) && within(block.tolerance ?? 0, 0, .01)
      } else if (type === 'short_answer') {
        valid = true
      }
      if (!valid) continue
      const neutralOptions = type === 'choice'
        ? [...new Set([
            ...(Array.isArray(block.neutralOptions) ? block.neutralOptions.filter((i) => Number.isInteger(i) && i >= 0 && i < block.options.length && i !== block.answer) : []),
            ...block.options.map((opt, idx) => (idx !== block.answer && isUnknownOption(opt) ? idx : -1)).filter((idx) => idx >= 0),
          ])]
        : undefined
      question = {
        id: randomUUID(),
        type,
        prompt: string(block.prompt, 2000),
        hint: string(block.hint, 600),
        explanation: string(block.explanation, 2000),
        answer: type === 'short_answer' ? null : block.answer,
        tolerance: type === 'number' ? block.tolerance ?? 0 : 0,
        options: ['choice', 'multi_choice'].includes(type) ? block.options.map((o) => string(o, 500)) : undefined,
        neutralOptions,
        tries: 0,
      }
      presentation.push(questionBlock(question))
    }
  }
  if (!presentation.length) throw new Error('No supported teaching content')
  const actions = []
  if (question) {
    actions.push(action('answer.submit', '提交答案', { target: question.id }))
  }
  if (explorerConfig && explorerConfig.component === 'equation' && explorerConfig.interactive !== false) {
    actions.push(action('exploration.submit', '我观察好了', { target: explorerConfig.instanceId, config: explorerConfig }))
  }
  if (!question && !explorerConfig) {
    const lastText = [...presentation].reverse().find((b) => b.type === 'text')?.props?.text || ''
    const asksOpenQuestion = /[？?]\s*$/.test(lastText.trim()) || candidate?.pedagogy?.move === 'probe_reason'
    if (!asksOpenQuestion) {
      const firstSuggestion = Array.isArray(candidate.suggestions) ? candidate.suggestions.find((s) => s && string(s.label, 40) && string(s.prompt, 600)) : null
      if (firstSuggestion) {
        actions.push(action('teacher.request', firstSuggestion.label, { prompt: firstSuggestion.prompt, intent: 'followup' }))
      }
    }
  }

  const proposedSkillClaim = candidate.proposed_skill_claim && string(candidate.proposed_skill_claim.skillId, 80) && ['unobserved', 'emerging', 'understood', 'validated'].includes(candidate.proposed_skill_claim.level)
    ? { skillId: string(candidate.proposed_skill_claim.skillId, 80), level: candidate.proposed_skill_claim.level }
    : null
  const proposedTaskAction = candidate.proposed_task_action && ['continue', 'offer_repair', 'resume_parent'].includes(candidate.proposed_task_action.type)
    ? { type: candidate.proposed_task_action.type, targetSkillId: string(candidate.proposed_task_action.targetSkillId, 80) || null, reason: string(candidate.proposed_task_action.reason, 200) || '' }
    : null

  return {
    frame: frame(presentation, actions),
    question,
    explorerConfig,
    topic: string(candidate.topic, 100) || '',
    resolution,
    proposedSkillClaim,
    proposedTaskAction,
    ...normalizeTeacherMetadata(candidate, evidenceSources),
  }
}

// Streaming parser for the teacher output protocol:
// line 1 is an optional `@@dec {json}` decision line, then flowing markdown text
// interleaved with ```learn-<type> component fences. Text deltas are surfaced
// immediately (typewriter); a component is emitted once its fence closes.
// Invalid fences degrade (component dropped, text kept) instead of failing the turn.
export function createTeacherOutputParser({ allowQuestion = true, evidenceSources = [] } = {}) {
  let buffer = ''
  let outPos = 0
  let consumingDecision = false
  let decisionStart = 0
  let pendingDecisionClose = 0
  let decisionRaw = null
  let fence = null
  let fenceSearchFrom = 0
  const presentation = []
  const actions = []
  let question = null
  let explorerConfig = null
  let textRun = ''
  const componentIssues = []

  const bounded = (v, n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n && !containsUnsafeMarkup(v)
  const str = (v, max = 3000) => (typeof v === 'string' && v.trim() && v.length <= max && !containsUnsafeMarkup(v) ? v.trim() : null)
  const list = (v, max) => Array.isArray(v) && v.length > 0 && v.length <= max
  const within = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high
  const pushText = () => {
    const t = textRun.trim()
    if (t) presentation.push(textBlock(t))
    textRun = ''
  }
  const takeText = (to, out) => {
    if (to > outPos) {
      const text = buffer.slice(outPos, to)
      textRun += text
      out.text += text
      out.events.push({ type: 'text', payload: { text } })
      outPos = to
    }
  }
  const findFenceStart = (from) => {
    const re = /```[ \t]*learn-([a-z_]+)/g
    re.lastIndex = from
    const m = re.exec(buffer)
    return m ? { index: m.index, type: m[1] } : null
  }
  // A @@dec marker only counts when it opens a line (leading spaces allowed).
  const findLineStartDecision = (from) => {
    let idx = buffer.indexOf('@@dec', from)
    while (idx !== -1) {
      let lineStart = idx
      while (lineStart > 0 && (buffer[lineStart - 1] === ' ' || buffer[lineStart - 1] === '\t')) lineStart--
      if (lineStart === 0 || buffer[lineStart - 1] === '\n') return lineStart
      idx = buffer.indexOf('@@dec', idx + 1)
    }
    return -1
  }

  function validateBlock(type, block) {
    if (['text', 'formula'].includes(type) && str(block.text)) return { kind: 'plain', props: { text: str(block.text) } }
    if (['outline', 'plan'].includes(type) && str(block.title, 120) && list(block.items, 6) && block.items.every((item) => item && str(item.title, 120) && str(item.detail, 600))) {
      return { kind: 'plain', props: { title: str(block.title, 120), items: block.items.map((item) => ({ title: str(item.title, 120), detail: str(item.detail, 600) })) } }
    }
    if (type === 'hint_panel' && list(block.hints, 3) && block.hints.every((h) => str(h, 500))) {
      return { kind: 'plain', props: { title: str(block.title, 100) || '分层提示', hints: block.hints.map((h) => str(h, 500)) } }
    }
    if (type === 'step_visualizer' && str(block.title, 120) && list(block.steps, 6) && block.steps.every((s) => s && str(s.label, 120) && str(s.detail, 600))) {
      return {
        kind: 'plain',
        props: {
          title: str(block.title, 120),
          steps: block.steps.map((s) => ({ label: str(s.label, 120), detail: str(s.detail, 600), ...(str(s.formula, 300) ? { formula: str(s.formula, 300) } : {}) })),
        },
      }
    }
    if (type === 'flashcards' && str(block.title, 120) && list(block.cards, 8) && block.cards.length >= 2 && block.cards.every((c) => c && str(c.front, 400) && str(c.back, 800))) {
      return {
        kind: 'plain',
        props: {
          title: str(block.title, 120),
          cards: block.cards.map((c) => ({ front: str(c.front, 400), back: str(c.back, 800), ...(str(c.tag, 40) ? { tag: str(c.tag, 40) } : {}) })),
        },
      }
    }
    if (type === 'diagram' && str(block.title, 120) && list(block.nodes, 6) && block.nodes.length >= 2 && block.nodes.every((n) => str(n, 80)) && list(block.edges, 8) && block.edges.every((edge) => Array.isArray(edge) && edge.length === 2 && edge.every((n) => Number.isInteger(n) && n >= 0 && n < block.nodes.length) && edge[0] !== edge[1])) {
      return { kind: 'plain', props: { title: str(block.title, 120), nodes: block.nodes.map((n) => str(n, 80)), edges: block.edges } }
    }
    if (type === 'explorer') {
      if (block.component === 'equation') {
        const normalizedEq = chemistryAdapter.normalizeEquationBlock(block)
        if (normalizedEq) return { kind: 'explorer', props: { instanceId: randomUUID(), component: 'equation', title: str(block.title, 120) || '化学反应原子示意图', reactants: normalizedEq.reactants, products: normalizedEq.products, interactive: block.interactive !== false } }
      } else if (block.component === 'sequence' && within(block.first, 1, 10) && within(block.ratio, 1, 4)) {
        return { kind: 'explorer', props: { instanceId: randomUUID(), component: 'sequence', first: block.first, ratio: block.ratio } }
      } else if (block.component === 'fraction' && Number.isInteger(block.parts) && within(block.parts, 2, 12) && Number.isInteger(block.selected) && within(block.selected, 1, block.parts)) {
        return { kind: 'explorer', props: { instanceId: randomUUID(), component: 'fraction', parts: block.parts, selected: block.selected } }
      } else if (block.component === 'linear' && within(block.slope, -3, 3) && within(block.intercept, -5, 5)) {
        return { kind: 'explorer', props: { instanceId: randomUUID(), component: 'linear', slope: block.slope, intercept: block.intercept } }
      } else if (block.component === 'balance' && Number.isInteger(block.left) && within(block.left, 1, 8) && Number.isInteger(block.unit) && within(block.unit, 1, 6) && Number.isInteger(block.target) && within(block.target, 1, 48)) {
        return { kind: 'explorer', props: { instanceId: randomUUID(), component: 'balance', left: block.left, unit: block.unit, target: block.target } }
      }
      return null
    }
    if (['choice', 'multi_choice', 'number', 'short_answer'].includes(type) && str(block.prompt, 2000)) {
      let valid = false
      if (type === 'choice') {
        valid = list(block.options, 6) && block.options.length >= 2 && block.options.every((o) => str(o, 500)) && new Set(block.options).size === block.options.length && Number.isInteger(block.answer) && block.answer >= 0 && block.answer < block.options.length
      } else if (type === 'multi_choice') {
        valid = list(block.options, 6) && block.options.length >= 2 && block.options.every((o) => str(o, 500)) && new Set(block.options).size === block.options.length && Array.isArray(block.answer) && block.answer.length >= 1 && block.answer.every((a) => Number.isInteger(a) && a >= 0 && a < block.options.length)
      } else if (type === 'number') {
        valid = within(block.answer, -1e6, 1e6) && within(block.tolerance ?? 0, 0, .01)
      } else valid = true
      if (!valid) return null
      const isUnknownOption = (text = '') => /不知道|不会数|没学过|不清楚|不确定|看不懂/.test(String(text))
      const neutralOptions = type === 'choice'
        ? [...new Set([
            ...(Array.isArray(block.neutralOptions) ? block.neutralOptions.filter((i) => Number.isInteger(i) && i >= 0 && i < block.options.length && i !== block.answer) : []),
            ...block.options.map((opt, idx) => (idx !== block.answer && isUnknownOption(opt) ? idx : -1)).filter((idx) => idx >= 0),
          ])]
        : undefined
      return {
        kind: 'question',
        props: {
          prompt: str(block.prompt, 2000),
          hint: str(block.hint, 600) || '',
          explanation: str(block.explanation, 2000) || '',
          answer: type === 'short_answer' ? null : block.answer,
          tolerance: type === 'number' ? block.tolerance ?? 0 : 0,
          options: ['choice', 'multi_choice'].includes(type) ? block.options.map((o) => str(o, 500)) : undefined,
          neutralOptions,
        },
      }
    }
    return null
  }

  function acceptComponent(type, bodyRaw, out) {
    let block
    try {
      block = JSON.parse(bodyRaw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    } catch { /* Record invalid data below. */ }
    if (block?.schema_version !== undefined && block.schema_version !== '1.0') {
      componentIssues.push({ type, reason: 'unsupported_version' })
      return
    }
    const validated = block && typeof block === 'object' && validateBlock(type, block)
    if (!validated) {
      componentIssues.push({ type, reason: 'invalid_or_unsupported' })
      return
    }
    if (validated.kind === 'explorer' && explorerConfig) {
      componentIssues.push({ type, reason: 'extra_explorer' })
      return
    }
    let blockOut
    let act
    if (validated.kind === 'question') {
      if (question || !allowQuestion) return
      question = { id: randomUUID(), type, tries: 0, ...validated.props }
      blockOut = questionBlock(question)
      act = action('answer.submit', '提交答案', { target: question.id })
    } else if (validated.kind === 'explorer') {
      explorerConfig = validated.props
      blockOut = { type: 'explorer', props: validated.props }
      if (validated.props.component === 'equation' && validated.props.interactive !== false) {
        act = action('exploration.submit', '我观察好了', { target: validated.props.instanceId, config: validated.props })
      }
    } else {
      blockOut = { type, props: validated.props }
    }
    presentation.push(blockOut)
    if (act) actions.push(act)
    const payload = { block: blockOut, ...(act ? { action: act } : {}) }
    out.components.push(payload)
    out.events.push({ type: 'component', payload })
  }

  function feed(delta) {
    buffer += delta
    const out = { text: '', components: [], events: [] }
    while (true) {
      if (fence) {
        const close = buffer.indexOf('\n```', fenceSearchFrom)
        if (close === -1) return out
        if (fence.type) acceptComponent(fence.type, buffer.slice(fence.bodyStart, close), out)
        outPos = close + 4
        fence = null
        continue
      }
      if (consumingDecision) {
        const nl = buffer.indexOf('\n', decisionStart)
        if (nl === -1) return out
        const line = buffer.slice(decisionStart, nl).trim()
        if (line.startsWith('@@dec')) {
          try { decisionRaw = JSON.parse(line.slice(5).trim()) } catch { decisionRaw = null }
        }
        outPos = nl + 1
        consumingDecision = false
        pendingDecisionClose = 2
        continue
      }
      if (pendingDecisionClose > 0) {
        // Tolerate blank lines and a closing ``` wrapper after the decision line.
        const rest = buffer.slice(outPos)
        const leading = rest.trimStart()
        if (!leading) return out
        if (leading.startsWith('```')) {
          const relNl = leading.indexOf('\n')
          if (relNl === -1) return out
          if (/```[ \t]*learn-/.test(leading.slice(0, relNl))) { pendingDecisionClose = 0; continue }
          outPos += rest.length - leading.length + relNl + 1
          pendingDecisionClose--
          continue
        }
        pendingDecisionClose = 0
        continue
      }
      const start = findFenceStart(outPos)
      const decAt = findLineStartDecision(outPos)
      if (decAt !== -1 && (start === null || decAt <= start.index)) {
        // A @@dec line anywhere before the next component fence is a decision,
        // not body text (flash models sometimes open with a transition phrase).
        // Drop a stray ```json wrapper line sitting right before the marker.
        const before = buffer.slice(outPos, decAt)
        const wrapMatch = before.match(/(?:^|\n)[ \t]*```[a-zA-Z]*[ \t]*\n$/)
        const keepEnd = wrapMatch ? outPos + wrapMatch.index + (wrapMatch.index === 0 ? 0 : 1) : decAt
        if (keepEnd > outPos) {
          if (buffer.slice(outPos, keepEnd).trim()) takeText(keepEnd, out)
        }
        pushText()
        consumingDecision = true
        decisionStart = decAt
        outPos = decAt
        continue
      }
      if (!start) {
        // Hold back a trailing run of backticks (fence marker split across
        // deltas) and a partial `@@dec` prefix so neither leaks as body text.
        let cut = buffer.length
        const lastTick = buffer.lastIndexOf('`')
        if (lastTick !== -1 && lastTick >= outPos) {
          cut = lastTick
          while (cut > outPos && buffer[cut - 1] === '`') cut--
        }
        const tailZone = buffer.slice(Math.max(outPos, buffer.length - 8))
        const at = tailZone.indexOf('@')
        if (at !== -1) cut = Math.min(cut, buffer.length - 8 + at)
        const safeEnd = Math.max(outPos, cut)
        takeText(safeEnd, out)
        return out
      }
      const nl = buffer.indexOf('\n', start.index)
      if (nl === -1) {
        // Fence info line not complete yet; hold everything from the marker on.
        takeText(start.index, out)
        return out
      }
      const infoLine = buffer.slice(start.index, nl)
      const type = (infoLine.match(/learn-([a-z_]+)/) || [])[1] || null
      takeText(start.index, out)
      pushText()
      fence = { type, bodyStart: nl + 1 }
      fenceSearchFrom = nl + 1
      outPos = nl + 1
    }
  }

  function finalize() {
    if (fence) {
      componentIssues.push({ type: fence.type, reason: 'incomplete' })
      fence = null
      outPos = buffer.length
    }
    if (consumingDecision) {
      const line = buffer.slice(decisionStart).trim()
      if (line.startsWith('@@dec')) {
        try { decisionRaw = JSON.parse(line.slice(5).trim()) } catch { decisionRaw = null }
      }
      consumingDecision = false
      outPos = buffer.length
    }
    if (outPos < buffer.length) textRun += buffer.slice(outPos)
    outPos = buffer.length
    pushText()
    if (!presentation.length) throw new Error('No supported teaching content')
    const candidate = decisionRaw && typeof decisionRaw === 'object' ? decisionRaw : null
    if (candidate?.visualRequired === true && !presentation.some((block) => ['diagram', 'explorer'].includes(block.type))) {
      componentIssues.push({ type: 'visual', reason: 'required_visual_missing' })
    }
    if (componentIssues.length) presentation.push({ type: 'notice', props: { text: '部分教学内容暂时无法显示。可以先看文字讲解，或请老师用另一种方式展示。' } })
    // @@dec fields are flat; wrap them as `pedagogy` for the metadata normalizer,
    // backfilling `check` so the decision survives the optional field being absent.
    let decision = null
    let observations = []
    if (candidate && bounded(candidate.move, 40)) {
      const meta = { move: candidate.move, objective: candidate.objective, check: candidate.check, reason: candidate.reason, evidenceRefs: candidate.evidenceRefs }
      if (!bounded(meta.check, 160)) meta.check = bounded(meta.objective, 160) ? meta.objective : '继续当前教学目标'
      const normalized = normalizeTeacherMetadata({ pedagogy: meta, observations: candidate.observations }, evidenceSources)
      decision = normalized.decision
      observations = normalized.observations
    }
    const resolution = ['keep', 'replace', 'resolve'].includes(candidate?.resolution) ? candidate.resolution : null
    const proposedSkillClaim = candidate?.proposed_skill_claim && str(candidate.proposed_skill_claim.skillId, 80) && ['unobserved', 'emerging', 'understood', 'validated'].includes(candidate.proposed_skill_claim.level)
      ? { skillId: str(candidate.proposed_skill_claim.skillId, 80), level: candidate.proposed_skill_claim.level }
      : null
    const proposedTaskAction = candidate?.proposed_task_action && ['continue', 'offer_repair', 'resume_parent'].includes(candidate.proposed_task_action.type)
      ? { type: candidate.proposed_task_action.type, targetSkillId: str(candidate.proposed_task_action.targetSkillId, 80) || null, reason: str(candidate.proposed_task_action.reason, 200) || '' }
      : null
    const assessment = candidate?.assessment
    return { frame: frame(presentation, actions), question, explorerConfig, assessment, componentIssues, diagnosisReady: candidate?.diagnosisReady === true, transferCheck: candidate?.transferCheck === true, topic: str(candidate?.topic, 100) || '', resolution, proposedSkillClaim, proposedTaskAction, decision, observations }
  }

  return { feed, finalize }
}

export function questionBlock(question) {
  return { type: question.type, props: { questionId: question.id, prompt: question.prompt, ...(question.options ? { options: question.options } : {}) } }
}

export function practiceCheckpoint(state, currentAnswer = state.evidence.at(-1)) {
  if (state.diagnosis?.active || !currentAnswer?.topic?.trim()) return null
  const answer = currentAnswer
  const singlePractice = [state.lastAnsweredQuestion, state.pending].some((question) => question?.id === answer.questionId && question.endsPractice)
  const attempts = currentAnswer === state.evidence.at(-1) ? state.evidence : [...state.evidence, currentAnswer]
  const seen = new Map()
  for (const attempt of [...attempts].reverse()) {
    if (attempt.questionId === state.practiceBoundary ||
        (answer.skillId && attempt.skillId ? answer.skillId !== attempt.skillId : answer.topic.trim() !== attempt.topic?.trim()) ||
        !attempt.correct || attempt.unsure || attempt.attempt !== 1 || attempt.assisted) break
    if (!seen.has(attempt.questionId)) seen.set(attempt.questionId, attempt)
  }
  if (seen.size < (singlePractice ? 1 : 2)) return null
  const explained = [...seen.values()].some((attempt) => attempt.reasoningExcerpt)
  return { topic: answer.topic, count: seen.size, questionId: answer.questionId, explained }
}

export function closePractice(checkpoint) {
  const performance = checkpoint.count === 1 ? '你答对了这道变式题。' : `你连续答对了 ${checkpoint.count} 道题，能在这些题里作出正确判断。`
  return frame([
    textBlock(`「${checkpoint.topic}」可以先告一段落了。${performance}${checkpoint.explained ? '你也说出了自己的判断依据。' : '能不能自己解释理由，我们还没验证。'}\n\n可以继续下一个知识点，也可以就停在这里。${checkpoint.explained ? '' : '如果想确认理解，可以用自己的话说一句判断依据。'}`),
  ], [
    action('teacher.request', '继续下一个知识点', { intent: 'advance_lesson', display: '这个知识点先到这里，请带我学下一个。', prompt: `请在当前课程范围内，从「${checkpoint.topic}」推进到下一个相关知识点。先讲一个简短的新例子，不要继续出上一知识点的同类题。` }),
    action('teacher.request', '再练一道', { intent: 'request_practice', display: '我想再练一道。', prompt: `请给我一道关于「${checkpoint.topic}」的变式题，然后等我回答。` }),
  ])
}

export function publicState(state, revision) {
  return { revision, phase: state.phase, level: state.studyScope || state.level, topic: state.topic, active: state.active, pending: state.pending && questionBlock(state.pending), evidence: state.evidence, objective: state.lastDecision?.objective || '', ...(state.followUp ? { followUp: { key: state.followUp.key, failed: state.followUp.failed === true } } : {}), ...(state.diagnosis?.active ? { diagnosis: { active: true } } : {}) }
}

export function applyLearningEvent(subject, state, event) {
  const next = structuredClone(state)
  const issued = state.active.actions.find((a) => a.id === event.actionId)
  if (!issued || issued.kind === 'teacher.request') throw Object.assign(new Error('这个操作已经失效，请刷新后继续。'), { status: 409 })

  if (issued.kind === 'level.select') {
    if (!levels.includes(event.value)) throw Object.assign(new Error('请选择本学科的学习阶段。'), { status: 400 })
    next.level = event.value
    next.studyScope = null
    next.phase = 'ready'
    next.active = readyFrame(subject, next)
    return { state: next, userText: `这门课从${event.value}开始。` }
  }

  if (issued.kind === 'exploration.submit') {
    const config = issued.config || {}
    const snapshot = event.value && typeof event.value === 'object' ? event.value : {}
    const note = typeof snapshot.note === 'string' ? snapshot.note.trim().slice(0, 600) : ''
    let summaryText = '我观察好了。'
    if (config.component === 'equation') {
      const reactants = (config.reactants || []).map((sp, i) => ({ ...sp, coeff: Number(snapshot.leftCoeffs?.[i] ?? sp.coeff ?? 1) }))
      const products = (config.products || []).map((sp, i) => ({ ...sp, coeff: Number(snapshot.rightCoeffs?.[i] ?? sp.coeff ?? 1) }))
      const fmt = (arr) => arr.map((s) => (s.coeff > 1 ? s.coeff : '') + s.formula).join(' + ')
      summaryText = `我观察好了，当前调整的方程式为：${fmt(reactants)} → ${fmt(products)}${note ? `。我的想法：${note}` : ''}`
    } else if (note) {
      summaryText = `我观察好了：${note}`
    }
    return {
      state: next,
      userText: summaryText,
      exploration: { instanceId: issued.target, config, snapshot, explanation: note },
      followUpPrompt: `学生提交了可视化探索结果：「${summaryText}」。请结合后端确定性校验结论给与针对性点评：若尚未平衡则指出具体哪些元素不守恒（不得说已配平），若已守恒且是最简比则追问背后的守恒原理以确认理解。`,
    }
  }

  if (issued.kind === 'answer.submit') {
    const q = next.pending
    if (!q || issued.target !== q.id) throw Object.assign(new Error('这道题已经结束，请继续当前学习。'), { status: 409 })
    const value = event.value
    const unsure = Boolean(event.unsure)

    let answerText = ''
    let isUnknown = false
    let correct = false
    if (q.type === 'choice') {
      if (!Number.isInteger(value) || value < 0 || value >= q.options.length) throw Object.assign(new Error('请选择有效的选项。'), { status: 400 })
      answerText = q.options[value]
      isUnknown = (q.neutralOptions || []).includes(value) || (value !== q.answer && isUnknownOption(answerText))
      correct = !isUnknown && value === q.answer
    } else if (q.type === 'multi_choice') {
      if (!Array.isArray(value) || !value.length || !value.every((v) => Number.isInteger(v) && v >= 0 && v < q.options.length)) throw Object.assign(new Error('请至少选择一个选项。'), { status: 400 })
      const sortedVal = [...new Set(value)].sort((a, b) => a - b)
      const sortedAns = [...q.answer].sort((a, b) => a - b)
      answerText = sortedVal.map((idx) => q.options[idx]).join('、')
      correct = sortedVal.length === sortedAns.length && sortedVal.every((v, i) => v === sortedAns[i])
    } else if (q.type === 'number') {
      if (!within(value, -1e6, 1e6)) throw Object.assign(new Error('请填写有效的数字。'), { status: 400 })
      answerText = String(value)
      correct = Math.abs(value - q.answer) <= q.tolerance
    } else if (q.type === 'short_answer') {
      if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Object.assign(new Error('请输入你的想法或回答。'), { status: 400 })
      answerText = value.trim()
      // Open-ended short answers are evaluated by LLM + Adapter, never blindly marked validated
      correct = false
    }

    if (!isUnknown && q.type !== 'short_answer') q.tries += 1
    next.evidence.push({ questionId: q.id, skillId: q.skillId, topic: q.topic || state.topic, prompt: q.prompt, value, answerText, correct, unsure, isUnknown, attempt: q.tries, assisted: q.assisted === true })
    next.evidence = next.evidence.slice(-60)
    next.lastAnsweredQuestion = q

    if (q.type === 'short_answer') {
      next.pending = null
      next.active = frame([textBlock('📝 已收到你的解答，我结合题意和你的思路说说看法。')], [])
      return {
        state: next,
        userText: answerText,
        questionSnapshot: { ...q, isUnknown: false },
        evidence: next.evidence.at(-1),
        followUpPrompt: `学生在简答题卡片提交了自己的解答：「${answerText}」。请根据题目要求与物理/化学/学科事实，先肯定他回答中正确的部分，若有误区或依据不足则温和追问或点破，不得盲目宣称已掌握。`,
      }
    }

    const feedbackText = isUnknown
      ? '💡 没关系，这正是我们从基础方法理顺的好起点。'
      : correct
        ? (unsure ? `✅ 答案是「${answerText}」，选对了！` : '✅ 回答正确！')
        : (q.tries === 1 ? `💡 ${(q.hint || '再想想刚才的关键点，我们一步一步来。')}` : `🔁 第 ${q.tries} 次：${q.hint || '换个角度看看这道题的关键条件。'}`)
    let followUpPrompt
    if (isUnknown) {
      next.active = frame([textBlock(feedbackText)], [])
      followUpPrompt = `我选择了「${answerText}」（表示不知道怎么数/还不了解前置方法，不是胡乱答错）。请按【完全不了解概念 → 用类比建立直觉（简短解释 text + 示意图 diagram 或 explorer:equation）】处理：先用通俗的话和直观图把数的方法/核心概念讲明白，本轮不要出测试题，暂时保留原题在后台（resolution:"keep"）。`
    } else if (correct) {
      next.pending = null
      next.active = frame([textBlock(feedbackText)], [])
      followUpPrompt = unsure
        ? `我刚提交了答案「${answerText}」（系统判定：答对，但我标记了“不太确定/猜的”）。请按【答对但理解不深 → 追问原因 → 开放式回答】处理：简短肯定后，只用一句开放式提问让我用自己的话说说为什么选它，本轮不要出选择题卡片。`
        : `我刚在题目「${q.prompt}」提交了答案「${answerText}」，按题目答案核对正确。界面已经给出正确反馈。简短解释要点后继续本节学习；只收结果的题卡不要追问步骤。如果有诊断目标，判断现有证据是否足够并尽快交接。不要把一次正确当作已掌握。`
    } else if (q.tries === 1) {
      next.active = frame([textBlock(feedbackText), questionBlock(q)], [
        action('answer.submit', '再试一次', { target: q.id }),
      ])
      followUpPrompt = `我刚提交了答案「${answerText}」（系统判定：第 1 次尝试答错）。请按【答错了 → 判断具体误区，给一层提示】处理：针对我选的「${answerText}」判断具体误区，在 text 中只给一层不泄底的启发提示，设置 resolution:"keep" 保留原题让我重试。`
    } else {
      next.active = frame([textBlock(feedbackText), questionBlock(q)], [
        action('answer.submit', '再试一次', { target: q.id }),
      ])
      followUpPrompt = `我刚提交了答案「${answerText}」（系统判定：已连续第 ${q.tries} 次答错）。这说明我在练习阶段暴露了对概念的不理解，请临时切换回【用类比建立直觉（简短解释 text + 示意图 diagram/explorer）】帮我讲清核心概念，或者提出先修补习建议（repair_offer），再决定回到原题还是替换为过渡题。`
    }
    return {
      state: next,
      userText: q.type === 'choice'
        ? `我选 ${String.fromCharCode(65 + value)}：${answerText}${unsure && !isUnknown ? '（不太确定）' : ''}。请判断并接着讲。`
        : unsure && !isUnknown ? `${answerText}（不太确定）` : answerText,
      questionSnapshot: { ...q, isUnknown },
      evidence: next.evidence.at(-1),
      followUpPrompt,
    }
  }
  throw Object.assign(new Error('不支持这个学习操作。'), { status: 400 })
}

export function contextForTeacher(state) {
  return { phase: state.phase, level: state.level, topic: state.topic, pending: state.pending && { prompt: state.pending.prompt, type: state.pending.type, options: state.pending.options, hint: state.pending.hint, tries: state.pending.tries }, evidence: state.evidence.slice(-12), lastDecision: state.lastDecision || null }
}

export function commitProposal(state, result, { prompt = '', intent = '' } = {}) {
  const next = structuredClone(state)
  if (result.decision) next.lastDecision = result.decision
  const wantsDirectOrSwitch = /直接讲|公布答案|跳过|换一道|换个|不做了|结束|太简单/.test(prompt) || ['explain', 'level_up'].includes(intent) || result.decision?.move === 'level_up'
  if (state.pending) {
    if (result.resolution === 'replace' && result.question) {
      next.pending = result.question
      next.active = result.frame
    } else if (result.resolution === 'resolve' || (state.pending.tries >= 2 && (result.question || wantsDirectOrSwitch)) || (wantsDirectOrSwitch && !result.question && result.decision?.move !== 'scaffold_demonstration')) {
      next.pending = result.question || null
      next.active = result.frame
    } else {
      const original = state.active.actions.find((a) => a.kind === 'answer.submit') || { id: randomUUID(), kind: 'answer.submit', label: '再试一次', target: state.pending.id }
      const hasQuestionBlock = result.frame.presentation.some((b) => b.props?.questionId === state.pending.id)
      const isMisconceptionHint = result.decision?.move === 'misconception_hint' || (state.pending.tries === 1 && !['build_intuition', 'answer_detour', 'scaffold_demonstration'].includes(result.decision?.move))
      const shouldInlineQuestion = ['hint', 'answer_followup'].includes(intent) && !hasQuestionBlock && isMisconceptionHint && state.evidence.at(-1)?.isUnknown !== true
      next.active = {
        ...result.frame,
        presentation: shouldInlineQuestion ? [...result.frame.presentation, questionBlock(state.pending)] : result.frame.presentation,
        actions: [
          ...result.frame.actions.filter((a) => a.kind !== 'answer.submit'),
          original,
        ],
      }
    }
  } else {
    next.pending = result.question
    next.active = result.frame
  }
  if (result.topic) next.topic = result.topic
  if (next.pending?.id && next.pending.id === state.pending?.id && ['hint', 'misconception_hint', 'scaffold_demonstration'].includes(result.decision?.move)) {
    next.pending.assisted = true
  }
  next.phase = 'learning'
  return next
}
