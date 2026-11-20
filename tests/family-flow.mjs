import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import sharp from 'sharp'
import { normalizeTeacherMetadata, planTeachingTurn, readSubjectMemory } from '../server/teacher.js'
import { applyLearningEvent, commitProposal, createTeacherOutputParser, normalizeProposal, opening, practiceCheckpoint } from '../server/learning.js'
import { evaluateTextAnswer } from '../server/evidence.js'
import { inferSkillId } from '../server/skills-registry.js'
import { asksForNewExercise, asksToDiagnose, requestedStudyScope } from '../server/study-routing.js'
import { chemistryAdapter, checkConservation, parseEquation } from '../server/adapters/chemistry.js'
import { mathAdapter } from '../server/adapters/math.js'
import { computeSkillProjection, applySkillStateUpdate, rebuildSkillStatesForLearner } from '../server/skills.js'
import { detectTaskCycle } from '../server/tasks.js'
import { runEvalBenchmarkSuite } from '../server/observability.js'

const root = '.local/qa/family-' + Date.now()
await mkdir(root, { recursive: true })
const schema = await readFile('server/schema.sql', 'utf8')
const legacy = await PGlite.create(root + '/migration')
await legacy.exec(schema.split('-- A parent owns the wallet')[0])
const legacyId = randomUUID(), oldConversation = randomUUID()
await legacy.query("INSERT INTO accounts VALUES ($1,NULL,'测试家长',NULL,true)", [legacyId])
await legacy.query("INSERT INTO learner_subjects VALUES ($1,'math','高二','数列')", [legacyId])
await legacy.query("INSERT INTO conversations (id,account_id,subject) VALUES ($1,$2,'math')", [oldConversation, legacyId])
await legacy.query('INSERT INTO wallets (account_id,balance,held) VALUES ($1,40,2)', [legacyId])
await legacy.exec(schema)
await legacy.exec(schema)
assert.deepEqual((await legacy.query('SELECT balance,held FROM wallets WHERE account_id=$1', [legacyId])).rows[0], { balance: 40, held: 2 })
const costColumns = await legacy.query("SELECT is_nullable FROM information_schema.columns WHERE table_name IN ('turns','homework_pages') AND column_name='cost'")
assert.equal(costColumns.rows.length, 2)
assert.ok(costColumns.rows.every(c => c.is_nullable === 'YES'))
assert.equal((await legacy.query('SELECT learner_id FROM conversations WHERE id=$1', [oldConversation])).rows[0].learner_id, legacyId)
assert.equal((await legacy.query('SELECT level FROM learner_subjects WHERE learner_id=$1', [legacyId])).rows[0].level, '高二')
const otherChild = randomUUID(), evidenceTurn = randomUUID()
await legacy.query("INSERT INTO learners (id,account_id,name) VALUES ($1,$2,'另一个学习档案')", [otherChild, legacyId])
await legacy.query("INSERT INTO turns (id,conversation_id,request_key,prompt,status,cost) VALUES ($1,$2,$3,'我刚才是猜的','completed',2)", [evidenceTurn, oldConversation, randomUUID()])
await legacy.query("INSERT INTO learning_observations (id,account_id,learner_id,subject,conversation_id,turn_id,kind,claim,source_id,source_excerpt) VALUES ($1,$2,$2,'math',$3,$4,'understanding_hypothesis','学生自述猜测，仍需确认理解',$5,'我刚才是猜的')", [randomUUID(), legacyId, oldConversation, evidenceTurn, 'turn:' + evidenceTurn])
assert.equal((await readSubjectMemory(legacy, legacyId, 'math')).observations.length, 1)
assert.equal((await readSubjectMemory(legacy, legacyId, 'english')).observations.length, 0)
assert.equal((await readSubjectMemory(legacy, otherChild, 'math')).observations.length, 0)
const sources = [{ id: 'source-1', text: '我刚才是猜的' }]
const observation = { kind: 'understanding_hypothesis', claim: '自述猜测，待进一步确认', sourceId: 'source-1' }
assert.equal(normalizeTeacherMetadata({ observations: [observation] }, sources).observations[0].status, 'tentative')
assert.equal(normalizeTeacherMetadata({ observations: [{ ...observation, sourceId: 'fabricated-source' }] }, sources).observations.length, 0)
assert.equal(normalizeTeacherMetadata({ observations: [observation] }, []).observations.length, 0)
import { subjects, inferSubjectFromText } from '../server/subjects.js'
const chemSubject = subjects.find((s) => s.id === 'chemistry')
const openFrame = opening(chemSubject, {})
assert.equal(openFrame.actions.length, chemSubject.topics.length + 1)
assert.equal(openFrame.actions[0].label, '开始学习')
assert.equal(openFrame.actions[0].id, opening(chemSubject, {}).actions[0].id)
assert.ok(openFrame.actions.every((a) => a.kind === 'teacher.request'))
assert.equal(inferSubjectFromText('我想学高中化学，化学方程式不会配平。'), 'chemistry')
const chemProposal = normalizeProposal({
  version: '1.0',
  topic: '化学方程式配平',
  pedagogy: {
    move: 'diagnose_baseline',
    objective: '确认学生是否能正确数出左右氧原子个数',
    check: '能否答出两边氧原子数量差异',
    reason: '学生首次学习配平，先用一个零压力诊断题判断其下标计数能力。',
  },
  blocks: [
    { type: 'text', text: '我们从简单的反应开始：' },
    { type: 'formula', text: 'H_2 + O_2 \\rightarrow H_2O' },
    { type: 'explorer', component: 'equation', title: '原子视角', reactants: [{ formula: 'H2', coeff: 1, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }], products: [{ formula: 'H2O', coeff: 1, atoms: { H: 2, O: 1 } }], interactive: true },
    { type: 'choice', prompt: '左右两边氧原子的数量一样吗？', options: ['一样', '不一样', '我不知道怎么数'], answer: 1, neutralOptions: [2], hint: '看 O 下标', explanation: '左边2个氧，右边1个氧。' },
  ],
})
assert.equal(chemProposal.frame.presentation.filter((b) => b.type === 'explorer').length, 1)
assert.equal(chemProposal.decision.reason, '学生首次学习配平，先用一个零压力诊断题判断其下标计数能力。')
let diagState = commitProposal({ phase: 'learning', level: '高一', topic: '', pending: null, evidence: [], active: openFrame }, chemProposal)
const diagSubmit = diagState.active.actions.find((a) => a.kind === 'answer.submit')
const unknownRes = applyLearningEvent(chemSubject, diagState, { actionId: diagSubmit.id, value: 2 })
assert.equal(unknownRes.evidence.isUnknown, true)
assert.equal(unknownRes.state.pending.tries, 0)
assert.ok(unknownRes.state.active.presentation.some((b) => b.type === 'text' && b.props.text.startsWith('💡')))
assert.ok(unknownRes.followUpPrompt.includes('不知道怎么数'))

const fcProposal = normalizeProposal({
  version: '1.0',
  topic: '一次函数与闪卡',
  resolution: 'replace',
  blocks: [
    { type: 'text', text: '我们结合 **一次函数** $y = kx + b$ 来观察：' },
    { type: 'flashcards', title: '函数速记卡', cards: [{ front: '$k$ 决定什么？', back: '决定直线的倾斜方向和陡峭度', tag: '斜率' }, { front: '$b$ 决定什么？', back: '决定与 $y$ 轴交点位置', tag: '截距' }] },
    { type: 'explorer', component: 'linear', slope: 1.5, intercept: -2 },
    { type: 'explorer', component: 'balance', left: 2, unit: 3, target: 6 },
    { type: 'number', prompt: '当 $x = 2$ 时，$y = 2x + 1$ 的值是多少？', answer: 5, hint: '把 2 代入 x', explanation: '2 × 2 + 1 = 5' },
  ],
  suggestions: [{ label: '多余按钮', prompt: '不应在有题目时显示' }],
})
assert.equal(fcProposal.frame.presentation.filter((b) => b.type === 'flashcards').length, 1)
assert.equal(fcProposal.frame.presentation.filter((b) => b.type === 'explorer').length, 2)
assert.equal(fcProposal.frame.actions.length, 1)
assert.equal(fcProposal.frame.actions[0].kind, 'answer.submit')
assert.equal(fcProposal.resolution, 'replace')
let studyState = commitProposal({ phase: 'learning', level: '初二', topic: '', pending: null, evidence: [], active: openFrame }, fcProposal)
assert.ok(studyState.pending)
const submitAct = studyState.active.actions.find((a) => a.kind === 'answer.submit')
const wrongTry = applyLearningEvent({ id: 'math', name: '数学' }, studyState, { actionId: submitAct.id, value: 3 })
assert.ok(wrongTry.followUpPrompt.includes('第 1 次尝试答错'))
assert.equal(wrongTry.state.pending.tries, 1)
const detour = normalizeProposal({ version: '1.0', resolution: 'keep', blocks: [{ type: 'text', text: '先回顾这个条件。' }] })
const detourState = commitProposal(wrongTry.state, detour, { intent: 'question' })
assert.equal(detourState.active.actions.find((item) => item.kind === 'answer.submit')?.target, wrongTry.state.pending.id)
const submitAct2 = wrongTry.state.active.actions.find((a) => a.kind === 'answer.submit')
const unsureCorrect = applyLearningEvent({ id: 'math', name: '数学' }, wrongTry.state, { actionId: submitAct2.id, value: 5, unsure: true })
assert.ok(unsureCorrect.followUpPrompt.includes('追问原因'))
assert.equal(unsureCorrect.state.pending, null)
assert.equal(unsureCorrect.evidence.unsure, true)

// V1.0 Platform Unit & Invariant Checks (M04 / M05 / M06 / M08 / M11)
const parsedBadEq = parseEquation('H2 + O2 -> 2H2O')
assert.equal(parsedBadEq.error, undefined)
const badBal = checkConservation(parsedBadEq.reactants, parsedBadEq.products)
assert.equal(badBal.balanced, false)
assert.ok(badBal.differences.some((d) => d.element === 'H' && d.left === 2 && d.right === 4))

const parsedGoodEq = parseEquation('2H2 + O2 -> 2H2O')
const goodBal = checkConservation(parsedGoodEq.reactants, parsedGoodEq.products)
assert.equal(goodBal.balanced, true)
assert.equal(goodBal.simplest, true)

const parsedDoubleEq = parseEquation('4H2 + 2O2 -> 4H2O')
assert.equal(checkConservation(parsedDoubleEq.reactants, parsedDoubleEq.products).simplest, false)

const parsedTampered = parseEquation('H2 + O2 -> H2O2')
assert.equal(checkConservation(parsedTampered.reactants, parsedTampered.products, { reactants: parsedBadEq.reactants, products: parsedBadEq.products }).subscriptTampered, true)

assert.equal(mathAdapter.verifyLinearSolution('2x + 3 = 11', 4).balanced, true)
assert.equal(mathAdapter.verifyLinearSolution('2x + 3 = 11', 5).balanced, false)

assert.throws(() => normalizeProposal({ version: '1.0', topic: 'XSS', blocks: [{ type: 'text', text: '<script>alert(1)</script>危险' }] }), /Unsafe component configuration rejected/)
const richProp = normalizeProposal({
  version: '1.0',
  topic: '反应配平分步指导',
  blocks: [
    { type: 'hint_panel', title: '提示步骤', hints: ['先数氧原子', '再看氢原子配比'] },
    { type: 'step_visualizer', title: '配平步骤拆解', steps: [{ label: '列原子表', formula: 'H_2+O_2\\rightarrow H_2O', detail: '左边2O，右边1O' }, { label: '配水系数', formula: 'H_2+O_2\\rightarrow 2H_2O', detail: '右边氧变成2个' }] },
    { type: 'short_answer', prompt: '用自己的话说说为什么配平不能改写 H₂O 为 H₂O₂？', hint: '想一想改下标会发生什么', explanation: '改下标会变成另一类物质（过氧化氢），违背客观反应事实。' },
  ],
})
assert.equal(richProp.frame.presentation.filter((b) => ['hint_panel', 'step_visualizer', 'short_answer'].includes(b.type)).length, 3)

const singleProj = computeSkillProjection([{ id: 'ev1', verdict: 'correct', evidence_source: 'rule_engine', fact: '答对一题', inference: '' }])
assert.equal(singleProj.level, 'emerging')
const choiceQuestion = { id: 'current-question', type: 'choice', options: ['walk', 'walks'], answer: 1 }
const choiceAssessment = { questionId: choiceQuestion.id, answerExcerpt: 'walks', outcome: 'correct', reasoningExcerpt: '主语是 he' }
const textExplanation = evaluateTextAnswer(choiceQuestion, choiceAssessment, 'walks。主语是 he')
assert.equal(textExplanation.reasoningExcerpt, '主语是 he')
assert.equal(evaluateTextAnswer(choiceQuestion, choiceAssessment, 'walks。我猜的。').unsure, true)
assert.equal(evaluateTextAnswer(choiceQuestion, { ...choiceAssessment, questionId: 'another-question' }, 'walks。主语是 he'), null)
assert.equal(evaluateTextAnswer(choiceQuestion, { ...choiceAssessment, answerExcerpt: 'walk' }, 'walk').outcome, 'incorrect')
assert.equal(computeSkillProjection([{ id: 'text-1', verdict: 'correct', evidence_source: 'llm_semantic', assessment: textExplanation }]).level, 'understood')
assert.equal(inferSkillId('math', '这个我不会'), null)
assert.equal(inferSkillId('math', '分数大小比较'), 'math.fraction.compare')
assert.equal(inferSkillId('english', '一般现在时'), 'english.present_simple_agreement')
const mathSubject = subjects.find((s) => s.id === 'math')
const mathScope = requestedStudyScope('帮我学习高一数学', mathSubject)
assert.equal(mathScope.stage, '高一')
assert.equal(mathScope.broad, true)
assert.equal(requestedStudyScope('请讲高一数学的函数单调性', mathSubject).stage, '高一')
assert.equal(requestedStudyScope('我想学高一数学的函数单调性', mathSubject).broad, false)
assert.equal(asksToDiagnose('帮我看看函数应该从哪里学'), true)
assert.equal(asksToDiagnose('帮我学习高一数学'), false)
assert.equal(asksForNewExercise('请只给我这道单选题卡：A 增大，B 减小。'), true)
assert.equal(asksForNewExercise('我选 B，因为函数值变小。'), false)
assert.equal(requestedStudyScope('我今年高一，想学习化学', chemSubject).stage, '高一')
assert.equal(inferSkillId('chemistry', '化学变化与物理变化'), 'chem.physical_chemical_change')
const answeredCard = (questionId, topic = '化学变化与物理变化') => ({ questionId, topic, correct: true, attempt: 1, unsure: false })
const oldPractice = { evidence: [answeredCard('first'), answeredCard('second')] }
const checkpoint = practiceCheckpoint(oldPractice)
const fence = String.fromCharCode(96).repeat(3)
assert.equal(checkpoint.count, 2)
const continuePlan = planTeachingTurn({ text: '我选 B：蜡烛燃烧生成水和二氧化碳。请判断并接着讲。', progress: checkpoint, continuation: true })
assert.equal(continuePlan.goal, 'continue_with_new_evidence')
assert.equal(continuePlan.moves.includes('recap'), false)
assert.equal(planTeachingTurn({ text: '我今天不学了', progress: checkpoint }).questionMode, 'none')
assert.equal(planTeachingTurn({ text: '能不能快一点，直接讲' }).questionMode, 'none')
assert.equal(planTeachingTurn({ text: '我是猜的' }).goal, 'verify_guess')
assert.equal(planTeachingTurn({ text: '我还是不懂，给我画图' }).visual, true)
assert.equal(planTeachingTurn({ text: '我想换一个知识点' }).goal, 'change_topic')
assert.equal(evaluateTextAnswer(choiceQuestion, null, '我选 B：walks。请判断并接着讲。').outcome, 'correct')
const plannedParser = createTeacherOutputParser({ teachingPlan: continuePlan, previousPrompts: ['哪个属于化学变化？'] })
plannedParser.feed('@@dec {"topic":"变化","move":"compare","objective":"理解证据"}\n先看两个现象。\n' +
  fence + 'learn-comparison\n{"title":"观察对照","items":[{"title":"一","detail":"特征甲"},{"title":"二","detail":"特征乙"}]}\n' + fence + '\n' +
  fence + 'learn-choice\n{"prompt":"哪个属于化学变化？","options":["甲","乙"],"answer":1,"focus":"apply_rule"}\n' + fence + '\n' +
  fence + 'learn-short_answer\n{"prompt":"你会找什么证据？"}\n' + fence)
const plannedFrame = plannedParser.finalize()
assert.ok(plannedFrame.frame.presentation.some(item => item.type === 'comparison'))
assert.equal(plannedFrame.question.evidenceProbe, true)
assert.equal(plannedFrame.question.type, 'short_answer')
assert.equal(plannedFrame.decision.move, 'compare')
assert.match(plannedFrame.question.prompt, /说明你的判断依据/)
assert.equal(practiceCheckpoint({ ...oldPractice, practiceBoundary: 'second' }), null)
assert.equal(practiceCheckpoint({ evidence: [answeredCard('first'), answeredCard('first')] }), null)
assert.equal(practiceCheckpoint({ evidence: [answeredCard('first'), answeredCard('second', '原子计数')] }), null)
assert.equal(practiceCheckpoint({ evidence: [answeredCard('first'), { ...answeredCard('second'), unsure: true }] }), null)
assert.equal(practiceCheckpoint({ evidence: [answeredCard('first'), { ...answeredCard('second'), assisted: true }] }), null)
assert.equal(computeSkillProjection(['first', 'second'].map(id => ({ id, verdict: 'correct', evidence_source: 'rule_engine', assessment: { questionId: id } }))).level, 'emerging')
const richParser = createTeacherOutputParser()
const visualEvents = richParser.feed('先看图。\n' + fence + 'learn-diagram\n{"title":"流程","nodes":["甲","乙"],"edges":[[0,1]]}\n' + fence + '\n回到例子。\n')
assert.deepEqual(visualEvents.events.map((item) => item.type), ['text', 'component', 'text'])
assert.deepEqual(richParser.finalize().frame.presentation.map((item) => item.type), ['text', 'diagram', 'text'])
const invalidParser = createTeacherOutputParser()
invalidParser.feed('先看文字。\n' + fence + 'learn-diagram\n{"title":"无效节点","nodes":["甲","乙"],"edges":[[0,4]]}\n' + fence)
const degraded = invalidParser.finalize()
assert.equal(degraded.componentIssues[0].type, 'diagram')
assert.equal(degraded.frame.presentation.at(-1).type, 'notice')
const laterVersionParser = createTeacherOutputParser()
laterVersionParser.feed('先讲概念。\n' + fence + 'learn-diagram\n{"schema_version":"2.0","title":"流程","nodes":["甲","乙"],"edges":[[0,1]]}\n' + fence)
assert.equal(laterVersionParser.finalize().componentIssues[0].reason, 'unsupported_version')
await legacy.query(
  "INSERT INTO learning_evidence (id,learner_id,subject,conversation_id,skill_id,fact,inference,verdict,confidence,rule_version,model_version,evidence_source,submission_key) VALUES ($1,$2,'chemistry',$3,'chem.equation_balancing','单次选对题目','','correct',0.85,'chem-rule-v1.0','demo','rule_engine','sub-1')",
  [randomUUID(), legacyId, oldConversation],
)
const conflictRes = await applySkillStateUpdate(legacy, { learnerId: legacyId, skillId: 'chem.equation_balancing', proposedLevel: 'validated', actor: 'llm_proposal', reason: 'test conflict' })
assert.equal(conflictRes.conflictRejected, true)
assert.equal(conflictRes.toLevel, 'emerging')
await legacy.query(
  "INSERT INTO learning_evidence (id,learner_id,subject,conversation_id,skill_id,fact,inference,verdict,confidence,rule_version,model_version,evidence_source,submission_key) VALUES ($1,$2,'math',$3,'math.linear_eq','一次方程卡壳','','incorrect',0.8,'math-rule-v1.0','demo','rule_engine','sub-2')",
  [randomUUID(), legacyId, oldConversation],
)
await applySkillStateUpdate(legacy, { learnerId: legacyId, skillId: 'math.linear_eq', actor: 'orchestrator' })
const rebuilt = await rebuildSkillStatesForLearner(legacy, legacyId)
assert.equal(rebuilt.find((s) => s.skill_id === 'chem.equation_balancing')?.level, 'emerging')
assert.equal(rebuilt.find((s) => s.skill_id === 'math.linear_eq')?.level, 'review_needed')

const cycleCheck = detectTaskCycle(
  [
    { id: 't1', goal_id: 'g1', parent_task_id: null, skill_id: 'chem.equation_balancing', status: 'paused' },
    { id: 't2', goal_id: 'g1', parent_task_id: 't1', skill_id: 'chem.subscript_meaning', status: 'active' },
  ],
  { id: 't2', goal_id: 'g1', parent_task_id: 't1', skill_id: 'chem.subscript_meaning', status: 'active' },
  'chem.equation_balancing',
  'repeat',
)
assert.equal(cycleCheck.cycleDetected, true)

const evalReport = runEvalBenchmarkSuite({ normalizeProposal })
assert.equal(evalReport.passed, evalReport.total)
assert.equal(evalReport.total, 8)

await legacy.close()
console.log('PASS legacy migration, repeat startup, child/subject memory isolation and evidence requirements')

let modelMode = 'ok', calls = 0
const mock = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks))
  assert.ok(body.messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,'))
  calls++
  if (modelMode === 'fail') { res.writeHead(503); res.end('{}'); return }
  if (modelMode === 'slow') await new Promise((r) => setTimeout(r, 600))
  const result = { questions: [
    { number: '1', text: '计算 8 + 5。', studentAnswer: '12', correctAnswer: '13', explanation: '8 加 2 得 10，再加 3 得 13。', knowledge: '加法', verdict: 'wrong', confidence: .96 },
    { number: '2', text: '图形中的边长看不清。', studentAnswer: '无法识别', correctAnswer: '', explanation: '请补拍清晰图片。', knowledge: '', verdict: 'uncertain', confidence: .2 },
  ] }
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: modelMode === 'invalid' ? '{' : JSON.stringify(result) } }], usage: { prompt_tokens: 20, completion_tokens: 50 } }))
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const port = 4181
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', AGENT_MODE: 'demo', LOCAL_DATA_DIR: root + '/db', HOMEWORK_API_KEY: 'synthetic-test-key', HOMEWORK_BASE_URL: `http://127.0.0.1:${mock.address().port}`, HOMEWORK_MODEL: 'mock-vision' }
delete env.DATABASE_URL
env.NODE_ENV = 'test'
let app
function start() { app = spawn(process.execPath, ['server/index.js', '--production'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); app.stderr.on('data', (s) => process.stderr.write(s)); return app }
async function ready() { for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) return } catch {} await new Promise((r) => setTimeout(r, 200)) } throw new Error('Server startup failed') }
function client(cookie, child) {
  return async (path, body, method) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie, ...(child ? { 'X-Learner-Id': child } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (path.endsWith('/image') && response.ok) return { status: response.status, value: await response.arrayBuffer() }
    return { status: response.status, value: await response.json() }
  }
}
async function demo() { const r = await fetch(`http://127.0.0.1:${port}/api/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(r.status, 201); return { cookie: r.headers.get('set-cookie').split(';')[0], account: await r.json() } }
async function terminal(api, id) { for (let i = 0; i < 100; i++) { const data = (await api('/homework')).value; const page = data.pages.find((p) => p.id === id); if (['completed', 'failed'].includes(page?.status)) return { page, questions: data.questions.filter((q) => q.page_id === id) }; await new Promise((r) => setTimeout(r, 200)) } throw new Error('Homework timed out') }
try {
  start(); await ready()
  const one = await demo(), other = await demo(), api = client(one.cookie)
  assert.equal((await api('/wallet')).status, 404)
  const config = (await api('/config')).value
  assert.equal('cost' in config, false)
  assert.equal('cost' in config.homework, false)
  assert.equal('wallet' in (await api('/dashboard')).value, false)
  const child = (await api('/learners', { name: '第二个孩子' })).value
  const kid = client(one.cookie, child.id), outsider = client(other.cookie)
  const startedStudy = await kid('/study/start', { prompt: '我想学高中化学，化学方程式不会配平。' })
  assert.equal(startedStudy.status, 201)
  assert.equal(startedStudy.value.subject, 'chemistry')
  assert.equal((await kid('/subjects/math')).value.goal.level, '')
  await kid('/subjects/math', { level: '一年级', topic: '加法' }, 'PATCH')
  assert.equal((await api('/subjects/math')).value.goal.level, '')
  assert.equal((await client(other.cookie, child.id)('/dashboard')).status, 404)
  const image = 'data:image/png;base64,' + (await sharp({ create: { width: 160, height: 100, channels: 3, background: 'white' } }).png().toBuffer()).toString('base64')
  const body = { requestKey: randomUUID(), subject: 'math', level: '一年级', image }
  const submitted = await kid('/homework/pages', body)
  assert.equal(submitted.status, 202)
  const id = submitted.value.id
  const duplicates = await Promise.all([kid('/homework/pages', body), kid('/homework/pages', body)])
  assert.ok(duplicates.every((r) => r.value.id === id))
  assert.equal((await kid('/homework/pages', { ...body, subject: 'english' })).status, 409)
  let done = await terminal(kid, id)
  assert.equal(done.page.status, 'completed'); assert.equal(done.questions.length, 2); assert.equal(calls, 1)
  assert.equal((await api('/homework')).value.pages.length, 0)
  assert.equal((await outsider('/homework/pages/' + id + '/image')).status, 404)
  assert.equal((await api('/homework/pages/' + id + '/image')).status, 404)
  assert.equal((await kid('/homework/pages/' + id + '/image')).status, 200)
  const q = done.questions.find((q) => q.verdict === 'wrong')
  const learn = (await kid('/homework/questions/' + q.id + '/learn', {})).value
  assert.equal((await kid('/homework/questions/' + q.id + '/learn', {})).value.id, learn.id)
  assert.equal((await api('/conversations/' + learn.id)).status, 404)
  const chat = (await kid('/conversations/' + learn.id)).value
  assert.equal(chat.learning.phase, 'ready'); assert.equal(chat.learning.level, '一年级'); assert.equal(chat.homework.student_answer, '12')
  const reply = await kid('/conversations/' + learn.id + '/turns', { requestKey: randomUUID(), prompt: '请教我这道题' })
  assert.equal(reply.value.status, 'completed')
  const reflect = { requestKey: randomUUID(), text: '我先把 5 分成 2 和 3，凑成 10 再加 3。' }
  await kid('/homework/questions/' + q.id + '/reflect', reflect)
  await kid('/homework/questions/' + q.id + '/reflect', reflect)
  assert.equal((await kid('/conversations/' + learn.id)).value.homework.reflections.length, 1)
  assert.equal((await kid('/homework/questions/' + q.id, { text: '计算 8 + 6。', studentAnswer: '14', revision: 1 }, 'PATCH')).value.verdict, 'uncertain')
  assert.equal((await kid('/homework/questions/' + q.id, { text: '旧修改', studentAnswer: '', revision: 1 }, 'PATCH')).status, 409)
  assert.equal((await kid('/conversations/' + learn.id)).value.homework.text, '计算 8 + 6。')
  assert.equal((await kid('/homework/report')).value.subjects[0].reflected, 1)
  console.log('PASS child isolation, photo authorization, upload idempotency, teaching handoff, revision and reflection')
  modelMode = 'fail'
  const failed = (await kid('/homework/pages', { ...body, requestKey: randomUUID() })).value
  done = await terminal(kid, failed.id); assert.equal(done.page.status, 'failed')
  modelMode = 'ok'
  const retryBody = { requestKey: randomUUID() }
  await Promise.all([kid('/homework/pages/' + failed.id + '/retry', retryBody), kid('/homework/pages/' + failed.id + '/retry', retryBody)])
  done = await terminal(kid, failed.id); assert.equal(done.page.status, 'completed'); assert.equal(done.page.attempt, 2)
  modelMode = 'invalid'
  const invalid = (await kid('/homework/pages', { ...body, requestKey: randomUUID() })).value
  done = await terminal(kid, invalid.id); assert.equal(done.page.status, 'failed'); assert.equal(done.questions.length, 0)
  console.log('PASS provider failure, retry once completion, invalid protocol repair then failure')
  // Restart with an in-flight model call: recovery must release only its hold.
  modelMode = 'slow'
  const interrupted = (await kid('/homework/pages', { ...body, requestKey: randomUUID() })).value
  for (let i = 0; i < 50; i++) { if ((await kid('/homework')).value.pages.find((p) => p.id === interrupted.id).status === 'running') break; await new Promise((r) => setTimeout(r, 50)) }
  await new Promise((r) => { app.once('exit', r); app.kill() })
  start(); await ready()
  done = await terminal(kid, interrupted.id); assert.equal(done.page.status, 'failed')
  assert.match(done.page.error, /重启/)
  assert.equal((await kid('/conversations/' + learn.id)).value.homework.reflections.length, 1)
  console.log('PASS persisted history and interrupted job recovery after restart')

  // V1.0 Platform End-to-End Flow Verification (SSE, Catalog, Explorer Draft/Submit, TaskTree Repair/Resume, Progress, Privacy Export/Delete, Quality/Eval)
  const v1 = await demo(), v1api = client(v1.cookie)
  const catalogRes = await v1api('/catalog')
  assert.equal(catalogRes.status, 200)
  assert.ok(catalogRes.value.skills.some((s) => s.id === 'chem.equation_balancing'))
  assert.ok(catalogRes.value.skills.some((s) => s.id === 'math.linear_eq'))
  assert.equal(catalogRes.value.adapters.find((a) => a.subjectId === 'chemistry')?.supportsDeterministicCheck, true)
  assert.equal(catalogRes.value.adapters.find((a) => a.subjectId === 'math')?.supportsDeterministicCheck, true)
  assert.equal(Boolean(catalogRes.value.adapters.find((a) => a.subjectId === 'physics')?.supportsDeterministicCheck), false)

  const v1Study = (await v1api('/study/start', { prompt: '我想学高中化学，化学方程式不会配平。' })).value
  const convId = v1Study.id

  async function postStreamTurn(promptText) {
    const res = await fetch(`http://127.0.0.1:${port}/api/conversations/${convId}/turns/stream`, {
      method: 'POST',
      headers: { Cookie: v1.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText, requestKey: randomUUID() }),
    })
    assert.equal(res.status, 200)
    assert.ok((res.headers.get('content-type') || '').includes('text/event-stream'))
    const rawSse = await res.text()
    assert.ok(rawSse.includes('event: started'))
    assert.ok(rawSse.includes('event: stage'))
    assert.ok(rawSse.includes('event: done'))
    const startedLine = rawSse.split('\n\n').find((c) => c.includes('event: started'))
    const turnId = JSON.parse(startedLine.split('\n').find((l) => l.startsWith('data:')).slice(5)).turnId
    const doneChunk = rawSse.split('\n\n').find((c) => c.includes('event: done'))
    const doneTurn = JSON.parse(doneChunk.split('\n').find((l) => l.startsWith('data:')).slice(5))
    return { turnId, doneTurn }
  }

  const sse1 = await postStreamTurn('我想学高中化学，化学方程式不会配平。')
  assert.equal(sse1.doneTurn.status, 'completed')
  const polledTurn = await v1api('/turns/' + sse1.turnId)
  assert.equal(polledTurn.status, 200)
  assert.equal(polledTurn.value.id, sse1.turnId)
  const chat1 = (await v1api('/conversations/' + convId)).value
  const q1Id = chat1.learning.pending.props.questionId
  assert.ok(q1Id)

  const secretUserPhrase = '我不知道怎么数原子，能画个图看看吗？'
  await postStreamTurn(secretUserPhrase)
  const chat2 = (await v1api('/conversations/' + convId)).value
  const eqInst = chat2.interactionInstances.find((inst) => inst.component_type === 'equation')
  assert.ok(eqInst)
  assert.equal(chat2.learning.pending.props.questionId, q1Id)

  // Local draft snapshot without a model call or skill state mutation
  const draftSave = await v1api(`/conversations/${convId}/interactions/draft`, {
    instanceId: eqInst.id,
    snapshot: { leftCoeffs: [1, 1], rightCoeffs: [2], note: '草稿试算' },
  })
  assert.equal(draftSave.status, 200)
  assert.equal((await v1api('/progress')).value.states.length, 0)
  const reloadedChat2 = (await v1api('/conversations/' + convId)).value
  assert.equal(reloadedChat2.interactionInstances.find((i) => i.id === eqInst.id)?.draft_snapshot?.note, '草稿试算')

  // Submit unbalanced H2 + O2 -> 2H2O via exploration.submit (deterministic rejection)
  const exploreAct1 = reloadedChat2.learning.active.actions.find((a) => a.kind === 'exploration.submit')
  assert.ok(exploreAct1)
  const badExpRes = await v1api(`/conversations/${convId}/learning-events`, {
    requestKey: randomUUID(),
    actionId: exploreAct1.id,
    revision: reloadedChat2.learning.revision,
    value: { leftCoeffs: [1, 1], rightCoeffs: [2], note: '试算不平衡' },
  })
  assert.equal(badExpRes.status, 200)
  assert.equal(badExpRes.value.ruleEvaluation.verdict, 'incorrect')
  let progress1 = (await v1api('/progress')).value
  assert.ok(progress1.evidence.some((e) => e.verdict === 'incorrect' && e.evidence_source === 'rule_engine'))

  // Draw diagram again and submit balanced simplest 2H2 + O2 -> 2H2O
  await postStreamTurn('画个图再试一次配平')
  const chat3 = (await v1api('/conversations/' + convId)).value
  const exploreAct2 = chat3.learning.active.actions.find((a) => a.kind === 'exploration.submit')
  const goodExpRes = await v1api(`/conversations/${convId}/learning-events`, {
    requestKey: randomUUID(),
    actionId: exploreAct2.id,
    revision: chat3.learning.revision,
    value: { leftCoeffs: [2, 1], rightCoeffs: [2], note: '两边原子相等' },
  })
  assert.equal(goodExpRes.status, 200)
  assert.equal(goodExpRes.value.ruleEvaluation.verdict, 'correct')
  progress1 = (await v1api('/progress')).value
  assert.ok(progress1.evidence.some((e) => e.verdict === 'correct' && e.evidence_source === 'rule_engine'))
  assert.notEqual(progress1.states.find((s) => s.skill_id === 'chem.equation_balancing')?.level, 'validated')
  const feedbackSnapshot = (await v1api('/conversations/' + convId)).value
  const feedbackKey = feedbackSnapshot.learning.followUp?.key
  assert.ok(feedbackKey)
  assert.equal(feedbackKey, goodExpRes.value.followUp.key)
  const resumedFeedback = await v1api('/conversations/' + convId + '/turns', { requestKey: feedbackKey, followUp: true })
  assert.equal(resumedFeedback.value.status, 'completed')
  const replayFeedback = await v1api('/conversations/' + convId + '/turns', { requestKey: feedbackKey, followUp: true })
  assert.equal(replayFeedback.value.id, resumedFeedback.value.id)
  assert.equal((await v1api('/conversations/' + convId)).value.learning.followUp, undefined)
  assert.equal((await v1api('/progress')).value.evidence.length, progress1.evidence.length)

  // Hint request idempotency
  const hintKey = randomUUID()
  const h1 = await v1api(`/conversations/${convId}/hints`, { requestKey: hintKey, instanceId: eqInst.id, layer: 1 })
  const h2 = await v1api(`/conversations/${convId}/hints`, { requestKey: hintKey, instanceId: eqInst.id, layer: 1 })
  assert.equal(h1.value.duplicate, false)
  assert.equal(h2.value.duplicate, true)

  // TaskTree repair offer -> accept -> resume parent exact pending question restoration
  await postStreamTurn('我不会下标，想先补一下前置基础')
  const chat4 = (await v1api('/conversations/' + convId)).value
  assert.ok(chat4.learning.active.presentation.some((b) => b.type === 'repair_offer'))
  const acceptRepair = chat4.learning.active.actions.find((a) => a.kind === 'task.accept_repair')
  assert.ok(acceptRepair)
  const acceptRes = await v1api(`/conversations/${convId}/learning-events`, {
    requestKey: randomUUID(),
    actionId: acceptRepair.id,
    revision: chat4.learning.revision,
    value: true,
  })
  assert.equal(acceptRes.status, 200)
  const chatInRepair = (await v1api('/conversations/' + convId)).value
  assert.equal(chatInRepair.taskTree.activePath.length, 2)
  assert.equal(chatInRepair.learning.pending, null)
  const resumeRes = await v1api(`/conversations/${convId}/tasks/resume`, {
    requestKey: randomUUID(),
    taskId: chatInRepair.taskTree.activeTask.id,
  })
  assert.equal(resumeRes.status, 200)
  assert.equal(resumeRes.value.taskTree.activePath.length, 1)
  assert.equal(resumeRes.value.learning.pending.props.questionId, q1Id)

  // Cross-user audit denial + Anonymized quality metrics + EVAL endpoint + Privacy export/delete
  assert.equal((await outsider('/conversations/' + convId)).status, 404)
  const qualityRes = await v1api('/quality/metrics')
  assert.equal(qualityRes.status, 200)
  assert.ok(qualityRes.value.summary.deniedAccessAudits >= 1)
  assert.equal(JSON.stringify(qualityRes.value).includes(secretUserPhrase), false)

  const evalApiRes = await v1api('/quality/eval', {})
  assert.equal(evalApiRes.status, 200)
  assert.equal(evalApiRes.value.passed, 8)
  assert.equal(evalApiRes.value.total, 8)

  const exported = await v1api('/account/export')
  assert.equal(exported.status, 200)
  assert.ok(exported.value.evidence.length >= 2)
  assert.ok(exported.value.goals.length >= 1)

  const deleted = await v1api('/account/history', null, 'DELETE')
  assert.equal(deleted.status, 200)
  assert.ok(deleted.value.deletedConversations >= 1)
  const afterDeleteProgress = (await v1api('/progress')).value
  assert.equal(afterDeleteProgress.states.length, 0)
  assert.equal(afterDeleteProgress.evidence.length, 0)
  console.log('PASS V1.0 catalog, SSE stream, explorer draft/submit, task repair/resume, quality metrics privacy, eval suite & export/delete')

} finally {
  if (app && app.exitCode === null) await new Promise(resolve => { app.once('exit', resolve); app.kill() })
  mock.close()
}
const verifiedDb = await PGlite.create(root + '/db')
try {
  for (const table of ['wallets', 'credit_entries']) assert.equal(Number((await verifiedDb.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n), 0)
  for (const table of ['turns', 'homework_pages']) assert.equal(Number((await verifiedDb.query(`SELECT count(*) AS n FROM ${table} WHERE cost IS NOT NULL`)).rows[0].n), 0)
  console.log('PASS learning, homework, failure and restart without wallets or billing writes')
} finally { await verifiedDb.close() }
console.log('ALL FAMILY FLOW CHECKS PASSED')
