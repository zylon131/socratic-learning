import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import express from 'express'
import sharp from 'sharp'
import { openDatabase } from './db.js'
import { mode } from './agent.js'
import { practice, subjects, inferSubjectFromText } from './subjects.js'
import { action, frame, initialState, normalizeProposal, opening, publicState, questionBlock, scopedOpening, textBlock } from './learning.js'
import { readSubjectMemory } from './teacher.js'
import { registerHomework, homeworkConfig, homeworkContext, homeworkOpening } from './homework.js'
import { seedCurriculumCatalog, inferSkillId } from './skills-registry.js'
import { getLearnerSkillArchive } from './skills.js'
import { ensureGoalAndRootTask, getTaskTree, resumeParentTask } from './tasks.js'
import { appendInteractionEvent } from './evidence.js'
import { deleteLearnerHistory, exportLearnerHistory, getAnonymizedQualityMetrics, logSecurityAudit, runEvalBenchmarkSuite } from './observability.js'
import { processLearningEvent, runOrchestratedTurn } from './orchestrator.js'
import { listAdapters } from './adapters/index.js'
import { matchCurriculumTopic, seedCurriculumTaxonomy, taxonomyAttribution, taxonomyPreviewEnabled, validateTaxonomyPreviewConfig } from './curriculum-taxonomy.js'
import { requestedStudyScope } from './study-routing.js'

const app = express()
validateTaxonomyPreviewConfig()
const db = await openDatabase()
await seedCurriculumCatalog(db)
await seedCurriculumTaxonomy(db)
const hashPassword = promisify(scrypt)
const sessionSeconds = 60 * 60 * 24 * 14
const isBuild = process.argv.includes('--production')
const host = process.env.HOST || '127.0.0.1'
const port = Number(process.env.PORT || 4175)
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host)
const demoEnabled = mode === 'demo' && loopback
const cookieOptions = { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.COOKIE_SECURE === 'true' }

app.disable('x-powered-by')
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ error: '请使用 JSON 提交。' })
  }
  next()
})
app.use('/api/homework/pages', express.json({ limit: '8mb' }))
app.use('/api/conversations', express.json({ limit: '6mb' }))
app.use(express.json({ limit: '24kb' }))
app.use('/api', (req, res, next) => {
  if (['POST', 'PATCH', 'DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).json({ error: '请从当前页面提交。' })
  next()
})

function fail(status, message) {
  throw Object.assign(new Error(message), { status })
}

function str(input, size) {
  return typeof input === 'string' ? input.trim().slice(0, size) : ''
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = (token) => createHash('sha256').update(token).digest('hex')
const getSubject = (id) => {
  const subject = subjects.find((item) => item.id === id)
  if (!subject) fail(404, '未找到这个学科。')
  return subject
}

async function first(source, sql, params = []) {
  return (await source.query(sql, params)).rows[0]
}

function publicAccount({ id, display_name: name, is_demo: demo }) {
  return { id, name, demo }
}

function sessionToken(req) {
  return /(?:^|;\s*)wenxue=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]
}

async function setSession(res, account) {
  const token = randomBytes(32).toString('hex')
  const expiry = new Date(Date.now() + sessionSeconds * 1000)
  await db.query('INSERT INTO account_sessions VALUES ($1, $2, $3)', [digest(token), account.id, expiry])
  res.cookie('wenxue', token, { ...cookieOptions, maxAge: sessionSeconds * 1000 })
}

async function auth(req, _res, next) {
  const token = sessionToken(req)
  req.account = token && await first(db, 'SELECT a.* FROM accounts a JOIN account_sessions s ON s.account_id = a.id WHERE s.token_hash = $1 AND s.expires_at > now()', [digest(token)])
  if (!req.account) fail(401, '请先登录。')
  const learnerId = req.headers['x-learner-id'] || req.account.id
  if (!uuid.test(learnerId)) fail(400, '孩子档案无效。')
  req.learner = await first(db, 'SELECT id, name FROM learners WHERE id = $1 AND account_id = $2', [learnerId, req.account.id])
  if (!req.learner) {
    await logSecurityAudit(db, { actorAccountId: req.account.id, targetResource: `learner:${learnerId}`, action: req.method + ' ' + req.path, outcome: 'denied', reason: 'learner_not_owned' })
    fail(404, '未找到这个孩子的档案。')
  }
  next()
}

async function createAccount({ email = null, name, passwordHash = null, demo = false }) {
  return db.transaction(async (tx) => {
    const account = await first(tx, 'INSERT INTO accounts VALUES ($1, $2, $3, $4, $5) RETURNING *', [randomUUID(), email, name, passwordHash, demo])
    await tx.query('INSERT INTO learners (id, account_id, name) VALUES ($1,$1,$2)', [account.id, '我的学习档案'])
    return account
  })
}

app.get('/api/config', (_req, res) => res.json({ demoEnabled, mode, homework: homeworkConfig }))
app.get('/api/me', auth, (req, res) => res.json(publicAccount(req.account)))
app.get('/api/learners', auth, async (req, res) => res.json((await db.query('SELECT id, name FROM learners WHERE account_id = $1 ORDER BY created_at, id', [req.account.id])).rows))
app.post('/api/learners', auth, async (req, res) => {
  const name = str(req.body?.name, 30)
  if (!name) fail(400, '请填写孩子的称呼。')
  const child = await db.transaction(async (tx) => {
    await first(tx, 'SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [req.account.id])
    if (Number((await first(tx, 'SELECT count(*) AS n FROM learners WHERE account_id = $1', [req.account.id])).n) >= 8) fail(400, '当前账号最多支持 8 个孩子档案。')
    return first(tx, 'INSERT INTO learners (id, account_id, name) VALUES ($1,$2,$3) RETURNING id,name', [randomUUID(), req.account.id, name])
  })
  res.status(201).json(child)
})
app.patch('/api/learners/:id', auth, async (req, res) => {
  const name = str(req.body?.name, 30)
  if (!uuid.test(req.params.id) || !name) fail(400, '请填写孩子的称呼。')
  const child = await first(db, 'UPDATE learners SET name = $3 WHERE id = $1 AND account_id = $2 RETURNING id,name', [req.params.id, req.account.id, name])
  if (!child) fail(404, '未找到孩子档案。')
  res.json(child)
})
app.post('/api/demo', async (_req, res) => {
  if (!demoEnabled) fail(404, '体验账户仅在本机演示模式开放。')
  const account = await createAccount({ name: '体验同学', demo: true })
  await setSession(res, account)
  res.status(201).json(publicAccount(account))
})
app.post('/api/register', async (req, res) => {
  const email = str(req.body?.email, 250).toLowerCase()
  const name = str(req.body?.name, 30)
  const password = req.body?.password
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    fail(400, '请填写昵称、有效邮箱和至少 8 位密码。')
  }
  const salt = randomBytes(16).toString('hex')
  const key = await hashPassword(password, salt, 64)
  try {
    const account = await createAccount({ email, name, passwordHash: salt + ':' + key.toString('hex') })
    await setSession(res, account)
    res.status(201).json(publicAccount(account))
  } catch (error) {
    if (error.code === '23505') fail(409, '此邮箱已注册，请直接登录。')
    throw error
  }
})
app.post('/api/login', async (req, res) => {
  const email = str(req.body?.email, 250).toLowerCase()
  const password = req.body?.password
  if (typeof password !== 'string' || !password || password.length > 128) fail(400, '请填写邮箱和密码。')
  const account = await first(db, 'SELECT * FROM accounts WHERE email = $1', [email])
  const [salt, key] = (account?.password_hash || 'c95b881b0ba2dfd74b20c42b9f8a4dfe:' + '0'.repeat(128)).split(':')
  const supplied = await hashPassword(password, salt, 64)
  if (!account || !timingSafeEqual(supplied, Buffer.from(key, 'hex'))) fail(401, '邮箱或密码有误。')
  await setSession(res, account)
  res.json(publicAccount(account))
})
app.post('/api/logout', async (req, res) => {
  const token = sessionToken(req)
  if (token) await db.query('DELETE FROM account_sessions WHERE token_hash = $1', [digest(token)])
  res.clearCookie('wenxue', cookieOptions).json({ ok: true })
})

async function releaseStale(accountId) {
  const cutoff = new Date(Date.now() - 120_000)
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE turns SET status = 'failed' WHERE status = 'running' AND created_at < $2 AND conversation_id IN (SELECT id FROM conversations WHERE account_id = $1)",
      [accountId, cutoff],
    )
  })
}

app.get('/api/dashboard', auth, async (req, res) => {
  const accountId = req.account.id
  await releaseStale(accountId)
  const { rows } = await db.query(
    "SELECT s.subject, g.level, g.topic, c.id AS conversation_id, c.title, c.updated_at, (a.correct + e.correct)::int AS correct " +
    "FROM (SELECT unnest($2::text[]) AS subject) s " +
    "LEFT JOIN learner_subjects g ON g.learner_id = $1 AND g.subject = s.subject " +
    "LEFT JOIN LATERAL (SELECT id, title, updated_at FROM conversations WHERE learner_id = $1 AND subject = s.subject ORDER BY updated_at DESC, id LIMIT 1) c ON true " +
    "LEFT JOIN LATERAL (SELECT count(*)::int AS correct FROM attempts WHERE learner_id = $1 AND subject = s.subject AND correct) a ON true " +
    "LEFT JOIN LATERAL (SELECT count(DISTINCT le.evidence ->> 'questionId')::int AS correct FROM learning_events le JOIN conversations lc ON lc.id = le.conversation_id WHERE lc.learner_id = $1 AND lc.subject = s.subject AND le.evidence ->> 'correct' = 'true') e ON true",
    [req.learner.id, subjects.map(({ id }) => id)],
  )
  const progress = new Map(rows.map((row) => [row.subject, row]))
  res.json({ subjects: subjects.map((subject) => ({ ...subject, ...progress.get(subject.id) })) })
})
app.get('/api/subjects/:subject', auth, async (req, res) => {
  const subject = getSubject(req.params.subject)
  const args = [req.learner.id, subject.id]
  const goal = await first(db, 'SELECT level, topic FROM learner_subjects WHERE learner_id = $1 AND subject = $2', args)
  const { rows: conversations } = await db.query('SELECT id, title, updated_at FROM conversations WHERE learner_id = $1 AND subject = $2 ORDER BY updated_at DESC, id', args)
  const question = demoEnabled ? practice[subject.id] : undefined
  const attempt = question && await first(db, 'SELECT choice, correct FROM attempts WHERE learner_id = $1 AND subject = $2 AND question_id = $3', [...args, question.id])
  const exercise = question && { id: question.id, title: question.title, prompt: question.prompt, options: question.options }
  const memory = await readSubjectMemory(db, req.learner.id, subject.id)
  const { rows: dueReviews } = await db.query(
    "SELECT q.id, q.text, q.knowledge_hint, r.due_at FROM homework_questions q JOIN homework_pages p ON p.id=q.page_id JOIN homework_reviews r ON r.question_id=q.id WHERE p.learner_id=$1 AND p.subject=$2 AND r.due_at <= now() ORDER BY r.due_at ASC LIMIT 5",
    args,
  )
  res.json({ subject, goal: goal || { level: '', topic: '' }, conversations, dueReviews, opening: publicState(initialState(subject, goal), 0), observations: memory.observations, exercise, attempt: attempt && { ...attempt, explanation: question.explanation } })
})

app.post('/api/study/start', auth, async (req, res) => {
  const prompt = str(req.body?.prompt, 4000)
  if (!prompt) fail(400, '说说你今天想学什么吧。')
  const requestedSubject = str(req.body?.subject, 40)
  const requestedSkill = str(req.body?.skillId, 90)
  const skill = requestedSkill
    ? await first(db, 'SELECT id, subject, title FROM skill_definitions WHERE id=$1', [requestedSkill])
    : await matchCurriculumTopic(db, prompt, requestedSubject)
  if (requestedSkill && !skill) fail(404, '没有找到这个知识点。')
  if (skill && requestedSubject && skill.subject !== requestedSubject) fail(400, '所选知识点与学科不同。')
  const subjectId = skill?.subject || (subjects.some((s) => s.id === requestedSubject) ? requestedSubject : inferSubjectFromText(prompt))
  const subject = getSubject(subjectId)
  const conversation = await db.transaction(async (tx) => {
    const created = await first(tx, 'INSERT INTO conversations (id, account_id, subject, learner_id, title) VALUES ($1, $2, $3, $4, $5) RETURNING id, subject, title, updated_at', [randomUUID(), req.account.id, subject.id, req.learner.id, (skill?.title || prompt).slice(0, 32)])
    if (skill) {
      await ensureGoalAndRootTask(tx, { learnerId: req.learner.id, subject: subject.id, conversationId: created.id, title: skill.title, skillId: skill.id, source: 'catalog' })
    }
    return created
  })
  res.status(201).json({ ...conversation, prompt })
})
app.patch('/api/subjects/:subject', auth, async (req, res) => {
  const subject = getSubject(req.params.subject)
  const level = str(req.body?.level, 30)
  const topic = str(req.body?.topic, 100)
  const conversation = req.body?.conversationId ? await ownConversation(req, req.body.conversationId) : null
  if (conversation && conversation.subject !== subject.id) fail(409, '会话与学科不一致。')
  const goal = await db.transaction(async (tx) => {
    if (conversation) {
      await first(tx, 'SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversation.id])
      if (await first(tx, "SELECT id FROM turns WHERE conversation_id = $1 AND status = 'running'", [conversation.id])) fail(409, '老师正在回复，请稍后调整学段。')
      const session = await ensureLearning(tx, conversation, req.account.id)
      const state = { ...session.state, level, studyScope: null }
      if (state.active.actions.some((item) => item.scopeStarter)) {
        const scope = requestedStudyScope(level + subject.name, subject)
        const updated = scope ? scopedOpening(subject, scope) : opening(subject, { level })
        state.active = { ...updated, responseId: state.active.responseId }
        state.topic = level ? level + subject.name : ''
      }
      await tx.query('UPDATE learning_sessions SET state = $2::jsonb, revision = revision + 1 WHERE conversation_id = $1', [conversation.id, JSON.stringify(state)])
    }
    return first(tx,
      'INSERT INTO learner_subjects VALUES ($1, $2, $3, $4) ON CONFLICT (learner_id, subject) DO UPDATE SET level = excluded.level, topic = excluded.topic RETURNING level, topic',
      [req.learner.id, subject.id, level, topic],
    )
  })
  res.json(goal)
})
app.post('/api/subjects/:subject/attempt', auth, async (req, res) => {
  if (!demoEnabled) fail(404, '示例练习仅用于隔离测试。')
  const subject = getSubject(req.params.subject)
  const question = practice[subject.id]
  const choice = req.body?.choice
  if (!question || req.body?.questionId !== question.id) fail(404, '练习已更新，请重新打开。')
  if (!Number.isInteger(choice) || choice < 0 || choice >= question.options.length) fail(400, '请选择一个答案。')
  const correct = choice === question.answer
  await db.query(
    'INSERT INTO attempts (learner_id, subject, question_id, choice, correct) VALUES ($1, $2, $3, $4, $5) ' +
    'ON CONFLICT (learner_id, subject, question_id) DO UPDATE SET choice = excluded.choice, correct = excluded.correct, updated_at = now()',
    [req.learner.id, subject.id, question.id, choice, correct],
  )
  res.json({ choice, correct, explanation: question.explanation })
})
app.post('/api/subjects/:subject/conversations', auth, async (req, res) => {
  const subject = getSubject(req.params.subject)
  const conversation = await first(db, 'INSERT INTO conversations (id, account_id, subject, learner_id) VALUES ($1, $2, $3, $4) RETURNING id, title, updated_at', [randomUUID(), req.account.id, subject.id, req.learner.id])
  res.status(201).json(conversation)
})

async function ownConversation(req, id = req.params.id) {
  if (!uuid.test(id)) fail(404, '未找到这个会话。')
  const conversation = await first(db, 'SELECT id, subject, title, learner_id, source_question_id FROM conversations WHERE id = $1 AND account_id = $2 AND learner_id = $3', [id, req.account.id, req.learner.id])
  if (!conversation) {
    await logSecurityAudit(db, { actorAccountId: req.account?.id, targetResource: `conversation:${id}`, action: req.method + ' ' + req.path, outcome: 'denied', reason: 'conversation_not_owned' })
    fail(404, '未找到这个会话。')
  }
  return conversation
}

async function ensureLearning(tx, conversation, accountId) {
  // All callers lock the conversation first; initial welcome is written only once.
  let session = await first(tx, 'SELECT * FROM learning_sessions WHERE conversation_id = $1', [conversation.id])
  if (!session) {
    const goal = await first(tx, 'SELECT level, topic FROM learner_subjects WHERE learner_id = $1 AND subject = $2', [conversation.learner_id, conversation.subject])
    const source = await homeworkContext(tx, conversation)
    const state = source ? homeworkOpening(getSubject(conversation.subject), goal, source) : initialState(getSubject(conversation.subject), goal)
    session = await first(tx, 'INSERT INTO learning_sessions (conversation_id, state) VALUES ($1, $2::jsonb) RETURNING *', [conversation.id, JSON.stringify(state)])
    await tx.query('INSERT INTO learning_messages (id, conversation_id, presentation) VALUES ($1, $2, $3::jsonb)', [randomUUID(), conversation.id, JSON.stringify(state.active)])
  } else if (!conversation.source_question_id && ['onboarding', 'ready'].includes(session.state?.phase)) {
    const turnCount = Number((await first(tx, 'SELECT count(*) AS n FROM turns WHERE conversation_id = $1', [conversation.id])).n)
    if (turnCount === 0) {
      const subj = getSubject(conversation.subject)
      const freshOpen = opening(subj, { level: session.state.level, topic: session.state.topic })
      if (JSON.stringify(session.state.active.presentation) !== JSON.stringify(freshOpen.presentation) || session.state.active.actions.length !== freshOpen.actions.length) {
        session.state.active = freshOpen
        session.state.phase = 'ready'
        session = await first(tx, 'UPDATE learning_sessions SET state = $2::jsonb WHERE conversation_id = $1 RETURNING *', [conversation.id, JSON.stringify(session.state)])
        await tx.query('UPDATE learning_messages SET presentation = $2::jsonb WHERE id = (SELECT id FROM learning_messages WHERE conversation_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1)', [conversation.id, JSON.stringify(session.state.active)])
      }
    }
  }
  return session
}

app.get('/api/conversations/:id', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  await releaseStale(req.account.id)
  const snapshot = await db.transaction(async (tx) => {
    await first(tx, 'SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversation.id])
    const session = await ensureLearning(tx, conversation, req.account.id)
    await ensureGoalAndRootTask(tx, { learnerId: conversation.learner_id, subject: conversation.subject, conversationId: conversation.id, title: session.state.topic || `${getSubject(conversation.subject).name}学习`, skillId: inferSkillId(conversation.subject, session.state.topic, null) })
    const { rows: turns } = await tx.query('SELECT id, coalesce(display_prompt, prompt) AS prompt, user_image, reply, presentation, status, task_id, teaching_intent, created_at FROM turns WHERE conversation_id = $1 ORDER BY created_at, id', [conversation.id])
    const { rows: messages } = await tx.query('SELECT * FROM learning_messages WHERE conversation_id = $1 ORDER BY created_at, id', [conversation.id])
    const { rows: interactionInstances } = await tx.query('SELECT id, component_type, schema_version, config, draft_snapshot, committed_snapshot, status, updated_at FROM interaction_instances WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20', [conversation.id])
    const taskTree = await getTaskTree(tx, conversation.id)
    return { turns, messages, learning: publicState(session.state, session.revision), taskTree, interactionInstances }
  })
  res.json({ ...conversation, ...snapshot, homework: await homeworkContext(db, conversation) })
})

app.post('/api/conversations/:id/interactions/draft', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { instanceId, snapshot } = req.body || {}
  if (!uuid.test(instanceId || '') || !snapshot || typeof snapshot !== 'object') fail(400, '交互组件草稿参数无效。')
  const updated = await first(
    db,
    'UPDATE interaction_instances SET draft_snapshot = $3::jsonb, updated_at = now() WHERE id = $1 AND conversation_id = $2 RETURNING id, draft_snapshot, updated_at',
    [instanceId, conversation.id, JSON.stringify(snapshot)],
  )
  if (!updated) fail(404, '未找到该交互组件实例。')
  res.json(updated)
})

app.post('/api/conversations/:id/hints', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { requestKey, instanceId = null, layer = 1 } = req.body || {}
  if (!uuid.test(requestKey || '')) fail(400, '提示记录参数无效。')
  const recorded = await db.transaction((tx) => appendInteractionEvent(tx, {
    conversationId: conversation.id,
    learnerId: req.learner.id,
    instanceId: uuid.test(instanceId || '') ? instanceId : null,
    actor: 'learner',
    eventType: 'hint_requested',
    payload: { layer: Number(layer) || 1 },
    idempotencyKey: requestKey,
  }))
  res.json({ ok: true, eventId: recorded.event.id, duplicate: recorded.duplicate })
})

app.post('/api/conversations/:id/tasks/resume', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { requestKey, taskId = null } = req.body || {}
  if (!uuid.test(requestKey || '')) fail(400, '恢复参数无效。')
  const result = await db.transaction(async (tx) => {
    await first(tx, 'SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversation.id])
    const session = await ensureLearning(tx, conversation, req.account.id)
    const resumed = await resumeParentTask(tx, { conversationId: conversation.id, currentTaskId: taskId, outcome: 'paused_by_user' })
    if (!resumed.resumed) fail(400, '当前已经在主任务中。')
    await appendInteractionEvent(tx, {
      conversationId: conversation.id,
      learnerId: req.learner.id,
      actor: 'learner',
      eventType: 'resume_requested',
      payload: { fromTaskId: resumed.closedChild?.id, toTaskId: resumed.parentTask?.id, voluntaryReturn: true },
      idempotencyKey: requestKey,
    })
    const nextState = structuredClone(session.state)
    const restoredPending = resumed.resumeFrame?.pendingQuestion || null
    nextState.pending = restoredPending
    if (resumed.parentTask?.title) nextState.topic = resumed.parentTask.title
    nextState.active = restoredPending
      ? frame([textBlock(`已回到主任务「**${nextState.topic}**」原题，之前暂停的内容保留如下：`), questionBlock(restoredPending)], [action('answer.submit', '提交答案', { target: restoredPending.id })])
      : frame([textBlock(`已回到主任务「**${nextState.topic}**」。`)], [])
    await tx.query('UPDATE learning_sessions SET state = $2::jsonb, revision = revision + 1 WHERE conversation_id = $1', [conversation.id, JSON.stringify(nextState)])
    await tx.query('INSERT INTO learning_messages (id, conversation_id, user_text, presentation) VALUES ($1,$2,$3,$4::jsonb)', [randomUUID(), conversation.id, '返回主任务', JSON.stringify(nextState.active)])
    return { learning: publicState(nextState, session.revision + 1), taskTree: await getTaskTree(tx, conversation.id) }
  })
  res.json(result)
})

app.post('/api/conversations/:id/learning-events', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { requestKey, actionId, revision, value, unsure } = req.body || {}
  if (!uuid.test(requestKey || '') || !uuid.test(actionId || '') || !Number.isInteger(revision)) fail(400, '学习操作参数无效。')
  await releaseStale(req.account.id)
  const result = await processLearningEvent(db, {
    accountId: req.account.id,
    learnerId: req.learner.id,
    conversation,
    subject: getSubject(conversation.subject),
    requestKey,
    actionId,
    revision,
    value,
    unsure,
  })
  res.json(result.existing ? result.existing.response : result.response)
})

async function reserveTurn(req, conversation) {
  const accountId = req.account.id
  const rawImage = req.body?.image
  let cleanImage = null
  if (rawImage !== undefined && rawImage !== null && rawImage !== '') {
    if (typeof rawImage !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawImage)) fail(400, '请上传有效的 JPG、PNG 或 WebP 题目图片。')
    const rawBuffer = Buffer.from(rawImage.slice(rawImage.indexOf(',') + 1), 'base64')
    if (rawBuffer.length > 5 * 1024 * 1024) fail(400, '单张图片过大，请压缩到 5 MB 以内。')
    try {
      const buf = await sharp(rawBuffer, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 1600, height: 2200, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer()
      const base64 = buf.toString('base64')
      cleanImage = { data: base64, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,' + base64 }
    } catch {
      fail(400, '图片无法读取，请换一张清晰照片。')
    }
  }
  const inputPrompt = str(req.body?.prompt, 4000) || (cleanImage ? '请看这张图，用学习模式一步步带我弄懂。' : '')
  const actionId = req.body?.actionId
  const revision = req.body?.revision
  const requestedIntent = str(req.body?.intent, 40)
  const silentDisplay = req.body?.silentDisplay === true
  const followUp = req.body?.followUp === true
  const key = req.body?.requestKey
  if ((!inputPrompt && !actionId && !followUp) || typeof key !== 'string' || !uuid.test(key) || (actionId && (!uuid.test(actionId) || !Number.isInteger(revision)))) fail(400, '请输入消息或选择学习操作。')
  const fingerprint = digest(JSON.stringify({ prompt: inputPrompt, actionId, revision, ...(followUp ? { followUp } : {}) }))
  await releaseStale(accountId)

  const reserved = await db.transaction(async (tx) => {
    if (conversation.source_question_id) await first(tx, 'SELECT id FROM homework_questions WHERE id = $1 FOR UPDATE', [conversation.source_question_id])
    await first(tx, 'SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversation.id])
    const previous = await first(tx, 'SELECT * FROM turns WHERE conversation_id = $1 AND request_key = $2', [conversation.id, key])
    if (previous) {
      if (previous.request_fingerprint ? previous.request_fingerprint !== fingerprint : previous.prompt !== inputPrompt) fail(409, '这条消息已提交，请重新发送。')
      if (followUp && previous.status === 'failed') {
        const session = await ensureLearning(tx, conversation, accountId)
        if (session.state.followUp?.key !== key) return { turn: previous, fresh: false }
        if (await first(tx, "SELECT id FROM turns WHERE conversation_id = $1 AND status = 'running'", [conversation.id])) fail(409, '上一条消息还在处理中。')
        const turn = await first(tx, "UPDATE turns SET status = 'running', created_at = now(), learning_revision = $2 WHERE id = $1 RETURNING *", [previous.id, session.revision])
        return { turn, fresh: true, learning: session.state }
      }
      return { turn: previous, fresh: false }
    }
    const session = await ensureLearning(tx, conversation, accountId)
    const issued = actionId && session.state.active.actions.find((a) => a.id === actionId && a.kind === 'teacher.request')
    if (actionId && (!issued || revision !== session.revision)) fail(409, '学习进度已更新，请刷新后继续。')
    if (followUp && (session.state.followUp?.key !== key || actionId || inputPrompt)) fail(409, '这条点评已接续，请刷新会话。')
    const prompt = followUp ? session.state.followUp.prompt : (issued?.prompt || inputPrompt)
    const intent = followUp ? 'answer_followup' : (issued?.intent || requestedIntent || 'question')
    if (await first(tx, "SELECT id FROM turns WHERE conversation_id = $1 AND status = 'running'", [conversation.id])) fail(409, '上一条消息还在处理中。')
    const displayPrompt = silentDisplay || followUp ? '' : (issued?.display || issued?.label || prompt)
    const turn = await first(tx, "INSERT INTO turns (id, conversation_id, request_key, prompt, status, learning_revision, intent, request_fingerprint, display_prompt, user_image) VALUES ($1, $2, $3, $4, 'running', $5, $6, $7, $8, $9) RETURNING *", [randomUUID(), conversation.id, key, prompt, session.revision, intent, fingerprint, displayPrompt, cleanImage?.dataUrl || null])
    if (!silentDisplay && !followUp) {
      await tx.query("UPDATE conversations SET updated_at = now(), title = CASE WHEN title = '新对话' THEN $2 ELSE title END WHERE id = $1", [conversation.id, displayPrompt.slice(0, 32)])
    } else {
      await tx.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversation.id])
    }
    await appendInteractionEvent(tx, {
      conversationId: conversation.id,
      learnerId: conversation.learner_id,
      actor: followUp ? 'system' : 'learner',
      eventType: followUp ? 'teacher_followup_requested' : 'message_submitted',
      payload: { turnId: turn.id, intent, hasImage: Boolean(cleanImage) },
      idempotencyKey: key,
    })
    return { turn, fresh: true, learning: session.state }
  })
  return { ...reserved, cleanImage }
}

app.post('/api/conversations/:id/turns', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { turn, fresh, learning, cleanImage } = await reserveTurn(req, conversation)
  if (!fresh) return res.json(turn)
  const completed = await runOrchestratedTurn(db, {
    accountId: req.account.id,
    conversation,
    turn,
    learning,
    cleanImage,
    subject: getSubject(conversation.subject),
    homework: await homeworkContext(db, conversation),
  })
  res.json(completed)
})

app.post('/api/conversations/:id/turns/stream', auth, async (req, res) => {
  const conversation = await ownConversation(req)
  const { turn, fresh, learning, cleanImage } = await reserveTurn(req, conversation)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let closed = false
  res.on('close', () => { closed = true })
  const emit = (event, data) => {
    if (closed || res.writableEnded) return
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  if (!fresh) {
    emit('done', turn)
    return res.end()
  }
  emit('started', { turnId: turn.id })
  const completed = await runOrchestratedTurn(db, {
    accountId: req.account.id,
    conversation,
    turn,
    learning,
    cleanImage,
    subject: getSubject(conversation.subject),
    homework: await homeworkContext(db, conversation),
    emit,
  })
  emit('done', completed)
  if (!closed && !res.writableEnded) res.end()
})

app.get('/api/turns/:id', auth, async (req, res) => {
  if (!uuid.test(req.params.id)) fail(404, '未找到该回合记录。')
  const row = await first(
    db,
    "SELECT t.id, t.conversation_id, coalesce(nullif(t.display_prompt, ''), t.prompt) AS prompt, t.user_image, t.reply, t.presentation, t.status, t.created_at FROM turns t JOIN conversations c ON c.id = t.conversation_id WHERE t.id = $1 AND c.account_id = $2 AND c.learner_id = $3",
    [req.params.id, req.account.id, req.learner.id],
  )
  if (!row) {
    await logSecurityAudit(db, { actorAccountId: req.account.id, targetResource: `turn:${req.params.id}`, action: 'GET /api/turns/:id', outcome: 'denied', reason: 'turn_not_owned' })
    fail(404, '未找到该回合记录。')
  }
  res.json(row)
})

// Catalog, Progress Archive, Privacy Export/Delete, and Anonymized Quality/Eval APIs
app.get('/api/catalog', auth, async (req, res) => {
  const { rows: skills } = await db.query('SELECT * FROM skill_definitions ORDER BY subject, id')
  const { rows: prerequisites } = await db.query('SELECT * FROM prerequisite_relations ORDER BY id')
  const { rows: states } = await db.query('SELECT skill_id, level, confidence, last_verified_at FROM skill_states WHERE learner_id = $1', [req.learner.id])
  res.json({ subjects, skills, prerequisites, states, adapters: listAdapters(), ...(taxonomyPreviewEnabled ? { taxonomyAttribution } : {}) })
})

app.get('/api/progress', auth, async (req, res) => {
  const archive = await getLearnerSkillArchive(db, req.learner.id)
  const { rows: goals } = await db.query('SELECT * FROM learning_goals WHERE learner_id = $1 ORDER BY updated_at DESC LIMIT 20', [req.learner.id])
  res.json({ learner: req.learner, subjects, adapters: listAdapters(), goals, ...archive })
})

app.patch('/api/recommendations/:id', auth, async (req, res) => {
  if (!uuid.test(req.params.id)) fail(404, '未找到建议。')
  const status = req.body?.status
  if (!['accepted', 'dismissed'].includes(status)) fail(400, '建议状态无效。')
  const updated = await first(db, 'UPDATE learning_recommendations SET status = $3, updated_at = now() WHERE id = $1 AND learner_id = $2 RETURNING *', [req.params.id, req.learner.id, status])
  if (!updated) fail(404, '未找到该建议。')
  res.json(updated)
})

app.get('/api/account/export', auth, async (req, res) => {
  res.json(await exportLearnerHistory(db, req.learner.id))
})

app.delete('/api/account/history', auth, async (req, res) => {
  res.json(await deleteLearnerHistory(db, req.learner.id))
})

app.get('/api/quality/metrics', auth, async (_req, res) => {
  res.json(await getAnonymizedQualityMetrics(db))
})

app.post('/api/quality/eval', auth, async (_req, res) => {
  res.json(runEvalBenchmarkSuite({ normalizeProposal }))
})

await registerHomework({ app, db, auth, first, fail, uuid, getSubject, ensureLearning })
app.use('/api', (_req, res) => res.status(404).json({ error: '未找到此接口。' }))
if (isBuild) {
  const build = resolve('dist')
  if (!existsSync(resolve(build, 'index.html'))) throw new Error('Run npm run build first')
  app.use(express.static(build))
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(build, 'index.html')))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true, hmr: false } })
  app.use(vite.middlewares)
}
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  const status = error.status || 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: status < 500 ? error.message : '服务暂时不可用，请稍后重试。' })
})

app.listen(port, host, () => console.log('问学 · http://' + host + ':' + port + ' · ' + mode))
