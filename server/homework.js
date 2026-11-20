import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { gradePage, homeworkConfig } from './homework-model.js'
import { initialState, textBlock } from './learning.js'
export { homeworkConfig }
const publicPage = 'id, subject, level, status, error, attempt, created_at, updated_at'
const hash = (value) => createHash('sha256').update(value).digest('hex')

export async function homeworkContext(db, conversation) {
  if (!conversation.source_question_id) return null
  const q = (await db.query('SELECT q.*, p.subject, p.level FROM homework_questions q JOIN homework_pages p ON p.id=q.page_id WHERE q.id=$1 AND p.learner_id=$2', [conversation.source_question_id, conversation.learner_id])).rows[0]
  if (!q) return null
  const { rows: reflections } = await db.query('SELECT text, created_at FROM homework_reflections WHERE question_id=$1 ORDER BY created_at DESC LIMIT 3', [q.id])
  return { ...q, reflections, note: '图片批改是可修正的模型建议，knowledge_hint未匹配标准知识点；学生反思是自述，不是掌握证明。先核实原题和思路，结合已提交的反思继续带学。' }
}

export function homeworkOpening(subject, goal, source) {
  const state = initialState(subject, goal)
  state.level = goal?.level || source.level || ''
  state.topic = source.knowledge_hint || '作业讲解'
  state.phase = 'ready'
  state.active = {
    version: '1.0', responseId: randomUUID(),
    presentation: [textBlock('我们接着这道作业学。我已经带上题目和你原来的答案，不用重新介绍背景。'), textBlock(source.text), textBlock('你原来写的是：' + (source.student_answer || '尚未识别到答案')), textBlock('先从你当时的想法开始；也可以直接让我讲解。批改建议会结合你的说明继续核对。')],
    actions: [
      { id: randomUUID(), kind: 'teacher.request', label: '带我弄懂这道题', intent: 'homework', prompt: '请从附带作业和我的原答案出发主动带学。先核对问题，用一个具体的小步骤带我理解，不重新询问年级，不直接假定我为什么做错。' },
      { id: randomUUID(), kind: 'teacher.request', label: '先讲解思路', intent: 'homework', prompt: '请结合附带作业直接讲解关键思路，说明参考答案是否成立，再推荐下一小步。' },
    ],
  }
  return state
}

export async function registerHomework({ app, db, auth, first, fail, uuid, getSubject, ensureLearning }) {
  const owns = async (req, id, tx = db) => {
    if (!uuid.test(id || '')) fail(404, '未找到这道题。')
    const q = await first(tx, 'SELECT q.*, p.subject, p.learner_id, p.level FROM homework_questions q JOIN homework_pages p ON p.id=q.page_id WHERE q.id=$1 AND p.account_id=$2 AND p.learner_id=$3', [id, req.account.id, req.learner.id])
    if (!q) fail(404, '未找到这道题。')
    return q
  }
  app.get('/api/homework', auth, async (req, res) => {
    const filter = req.query.subject ? getSubject(req.query.subject).id : null
    const args = [req.account.id, req.learner.id, filter]
    const { rows: pages } = await db.query(`SELECT ${publicPage} FROM homework_pages WHERE account_id=$1 AND learner_id=$2 AND ($3::text IS NULL OR subject=$3) ORDER BY created_at DESC LIMIT 60`, args)
    const { rows: questions } = await db.query('SELECT q.*, p.subject, p.level, r.due_at, r.last_submitted_at, c.id AS conversation_id FROM homework_questions q JOIN homework_pages p ON p.id=q.page_id LEFT JOIN homework_reviews r ON r.question_id=q.id LEFT JOIN conversations c ON c.source_question_id=q.id WHERE p.account_id=$1 AND p.learner_id=$2 AND ($3::text IS NULL OR p.subject=$3) ORDER BY p.created_at DESC, q.ordinal, q.id LIMIT 300', args)
    res.json({ pages, questions, limits: { pages: 60, questions: 300 } })
  })
  app.post('/api/homework/pages', auth, async (req, res) => {
    const { requestKey, subject: subjectId, level = '', image } = req.body || {}
    const subject = getSubject(subjectId)
    if (!uuid.test(requestKey || '') || typeof level !== 'string' || level.length > 30 || typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) fail(400, '请上传 JPG、PNG 或 WebP 图片并选择学科。')
    const fingerprint = hash(JSON.stringify({ learner: req.learner.id, subjectId, level, image }))
    const previous = await first(db, `SELECT ${publicPage}, fingerprint FROM homework_pages WHERE account_id=$1 AND request_key=$2`, [req.account.id, requestKey])
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail(409, '相同上传请求的内容已变化，请重新提交。')
      const { fingerprint: _, ...value } = previous
      return res.json(value)
    }
    if (!homeworkConfig.enabled) fail(503, '图片批改尚未配置；仍可进入学科自主学习。')
    const raw = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64')
    if (raw.length > 5 * 1024 * 1024) fail(400, '单张图片过大，请压缩到 5 MB 以内。')
    let clean
    try { clean = await sharp(raw, { limitInputPixels: 20_000_000 }).rotate().resize({ width: 2200, height: 3000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer() }
    catch { fail(400, '图片无法读取，请换一张清晰照片。') }
    const page = await db.transaction(async (tx) => {
      await first(tx, 'SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [req.account.id])
      const duplicate = await first(tx, `SELECT ${publicPage}, fingerprint FROM homework_pages WHERE account_id=$1 AND request_key=$2`, [req.account.id, requestKey])
      if (duplicate) {
        if (duplicate.fingerprint !== fingerprint) fail(409, '重复请求内容不一致。')
        const { fingerprint: _, ...value } = duplicate
        return value
      }
      const pending = await first(tx, "SELECT count(*) AS n FROM homework_pages WHERE account_id=$1 AND status IN ('queued','running')", [req.account.id])
      if (Number(pending.n) >= 12) fail(429, '已有 12 页正在处理，完成后再提交。')
      const value = await first(tx, `INSERT INTO homework_pages (id,account_id,learner_id,subject,level,request_key,fingerprint,image,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING ${publicPage}`, [randomUUID(), req.account.id, req.learner.id, subject.id, level, requestKey, fingerprint, clean])
      return value
    })
    res.status(202).json(page)
  })
  app.get('/api/homework/pages/:id/image', auth, async (req, res) => {
    if (!uuid.test(req.params.id)) fail(404, '图片不存在。')
    const page = await first(db, 'SELECT image FROM homework_pages WHERE id=$1 AND account_id=$2 AND learner_id=$3', [req.params.id, req.account.id, req.learner.id])
    if (!page) fail(404, '图片不存在。')
    res.type('jpeg').send(Buffer.from(page.image))
  })
  app.post('/api/homework/pages/:id/retry', auth, async (req, res) => {
    const key = req.body?.requestKey
    if (!uuid.test(req.params.id) || !uuid.test(key || '')) fail(400, '重试参数无效。')
    if (!homeworkConfig.enabled) fail(503, '图片批改尚未配置。')
    const page = await db.transaction(async (tx) => {
      await first(tx, 'SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [req.account.id])
      const item = await first(tx, `SELECT ${publicPage}, retry_key FROM homework_pages WHERE id=$1 AND account_id=$2 AND learner_id=$3 FOR UPDATE`, [req.params.id, req.account.id, req.learner.id])
      if (!item) fail(404, '作业不存在。')
      if (item.retry_key === key || item.status !== 'failed') return item
      return first(tx, `UPDATE homework_pages SET status='queued', error=NULL, attempt=attempt+1,retry_key=$2,updated_at=now() WHERE id=$1 RETURNING ${publicPage}`, [item.id, key])
    })
    res.json(page)
  })
  app.patch('/api/homework/questions/:id', auth, async (req, res) => {
    const { text, studentAnswer, revision } = req.body || {}
    if (typeof text !== 'string' || !text.trim() || text.length > 6000 || typeof studentAnswer !== 'string' || studentAnswer.length > 3000 || !Number.isInteger(revision)) fail(400, '请填写完整题干和识别到的答案。')
    const q = await db.transaction(async (tx) => {
      await owns(req, req.params.id, tx)
      await first(tx, 'SELECT id FROM homework_questions WHERE id=$1 FOR UPDATE', [req.params.id])
      const running = await first(tx, "SELECT t.id FROM turns t JOIN conversations c ON c.id=t.conversation_id WHERE c.source_question_id=$1 AND t.status='running'", [req.params.id])
      if (running) fail(409, '老师正在讲解，请等回复完成后再修正题目。')
      const updated = await first(tx, "UPDATE homework_questions SET text=$2,student_answer=$3,correct_answer='',explanation='原题已修正，原批改结论失效。请让学科老师结合新题核对。',verdict='uncertain',knowledge_hint='',confidence=0,edited=true,revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING *", [req.params.id, text.trim(), studentAnswer.trim(), revision])
      if (!updated) fail(409, '题目已更新，请刷新后再改。')
      return updated
    })
    res.json(q)
  })
  app.post('/api/homework/questions/:id/learn', auth, async (req, res) => {
    const value = await db.transaction(async (tx) => {
      const q = await owns(req, req.params.id, tx)
      await first(tx, 'SELECT id FROM homework_questions WHERE id=$1 FOR UPDATE', [q.id])
      let conversation = await first(tx, 'SELECT * FROM conversations WHERE source_question_id=$1', [q.id])
      if (!conversation) conversation = await first(tx, 'INSERT INTO conversations (id,account_id,learner_id,subject,title,source_question_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [randomUUID(), req.account.id, req.learner.id, q.subject, '作业 · ' + q.text.slice(0, 24), q.id])
      await ensureLearning(tx, conversation, req.account.id)
      await tx.query("INSERT INTO homework_reviews (question_id,due_at) VALUES ($1,now()+interval '2 days') ON CONFLICT DO NOTHING", [q.id])
      return { id: conversation.id, subject: conversation.subject }
    })
    res.json(value)
  })
  app.post('/api/homework/questions/:id/reflect', auth, async (req, res) => {
    const { text, requestKey } = req.body || {}
    if (!uuid.test(requestKey || '') || typeof text !== 'string' || !text.trim() || text.length > 3000) fail(400, '请写下这次独立作答或理解。')
    await db.transaction(async (tx) => {
      const q = await owns(req, req.params.id, tx)
      await first(tx, 'SELECT id FROM homework_questions WHERE id=$1 FOR UPDATE', [q.id])
      const previous = await first(tx, 'SELECT text FROM homework_reflections WHERE question_id=$1 AND request_key=$2', [q.id, requestKey])
      if (previous) { if (previous.text !== text.trim()) fail(409, '重复提交内容不一致。'); return }
      await tx.query('INSERT INTO homework_reflections (id,question_id,request_key,text) VALUES ($1,$2,$3,$4)', [randomUUID(), q.id, requestKey, text.trim()])
      await tx.query("INSERT INTO homework_reviews (question_id,due_at,last_submitted_at) VALUES ($1,now()+interval '3 days',now()) ON CONFLICT(question_id) DO UPDATE SET due_at=excluded.due_at,last_submitted_at=excluded.last_submitted_at", [q.id])
    })
    res.json({ ok: true, note: '已保存为独立作答自述，尚未判定掌握。可以让老师接着核对。' })
  })
  app.get('/api/homework/report', auth, async (req, res) => {
    const { rows } = await db.query("SELECT p.subject, count(*)::int AS total, count(*) FILTER (WHERE q.verdict='wrong')::int AS wrong, count(*) FILTER (WHERE q.verdict='uncertain')::int AS uncertain, count(*) FILTER (WHERE r.due_at<=now())::int AS due, count(*) FILTER (WHERE r.last_submitted_at IS NOT NULL)::int AS reflected FROM homework_questions q JOIN homework_pages p ON p.id=q.page_id LEFT JOIN homework_reviews r ON r.question_id=q.id WHERE p.account_id=$1 AND p.learner_id=$2 GROUP BY p.subject", [req.account.id, req.learner.id])
    res.json({ subjects: rows, note: '作业数量来自已完成识别的记录，判定为 AI 建议；复习提交仅表示留下了作答，不等于已掌握。' })
  })

  // Single local worker. Interrupted jobs become visible failures that can be retried.
  await db.transaction(async (tx) => {
    await tx.query("UPDATE homework_pages SET status='failed',error='上次批改因服务重启中断，请重试。',updated_at=now() WHERE status='running'")
  })
  async function work() {
    let page
    try {
      page = await db.transaction(async (tx) => {
        const item = await first(tx, "SELECT * FROM homework_pages WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED")
        if (item) await tx.query("UPDATE homework_pages SET status='running',updated_at=now() WHERE id=$1", [item.id])
        return item
      })
      if (page) {
        let result, error
        try { result = await gradePage(page.image, getSubject(page.subject), page.level) }
        catch (e) { error = e.message }
        await db.transaction(async (tx) => {
          const active = await first(tx, "SELECT id FROM homework_pages WHERE id=$1 AND status='running' AND attempt=$2 FOR UPDATE", [page.id, page.attempt])
          if (!active) return
          if (result) {
            for (const [ordinal, q] of result.questions.entries()) await tx.query('INSERT INTO homework_questions (id,page_id,number,text,student_answer,correct_answer,explanation,knowledge_hint,verdict,confidence,ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [randomUUID(), page.id, q.number, q.text, q.studentAnswer, q.correctAnswer, q.explanation, q.knowledge, q.verdict, q.confidence, ordinal])
          }
          await tx.query('UPDATE homework_pages SET status=$2,error=$3,usage=$4::jsonb,updated_at=now() WHERE id=$1', [page.id, result ? 'completed' : 'failed', error || null, result ? JSON.stringify(result.usage) : null])
        })
      }
    } catch (error) {
      // Surface infrastructure failure to the process operator; never claim completion.
      console.error('Homework worker failed', error.name)
      if (page) await db.transaction(async (tx) => {
        await tx.query("UPDATE homework_pages SET status='failed',error='批改保存失败，请重试。',updated_at=now() WHERE id=$1 AND status='running'", [page.id])
      })
    } finally { setTimeout(work, 1000).unref() }
  }
  setTimeout(work, 200).unref()
}
