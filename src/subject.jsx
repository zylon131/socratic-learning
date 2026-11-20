import React, { useContext, useEffect, useRef, useState } from 'react'
import { BookOpen, Clock3, CornerDownLeft, Image as ImageIcon, Layers, MessageCircle, PanelLeftClose, PanelLeftOpen, Plus, Send, X } from 'lucide-react'
import { LearnerContext, useLearnerApi, Notice, SubjectIcon, subjectLink } from './ui.jsx'
import { LearningResponse, TeacherMessage } from './learning.jsx'

const levels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

async function compressChatImage(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error('图片超过 12 MB，请换一张小一点的截图或照片。')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / bitmap.width, 2200 / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  if (dataUrl.length > 5_500_000) throw new Error('图片压缩后仍过大，请裁剪关键题目区域后再试。')
  return { name: file.name || '题目截图.jpg', dataUrl }
}

export function SubjectView({ subject, subjects = [], conversationId, config, refresh, active = true, onConversationChange }) {
  const learnerId = useContext(LearnerContext)
  const api = useLearnerApi()
  const [space, setSpace] = useState(null)
  const [chat, setChat] = useState(null)
  const [draft, setDraft] = useState('')
  const [attachedImage, setAttachedImage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [busyPhase, setBusyPhase] = useState('')
  const [error, setError] = useState('')
  const [showPending, setShowPending] = useState(false)
  const [live, setLive] = useState(null)
  const [localSent, setLocalSent] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760)
  const request = useRef(null)
  const eventRequest = useRef(null)
  const operation = useRef(false)
  const queued = useRef([])
  const draftTimers = useRef({})
  const bottom = useRef(null)
  const imageInput = useRef(null)
  const pendingAuto = useRef('')
  const resumedFeedback = useRef('')
  const selected = conversationId || space?.conversations[0]?.id
  const selectedRef = useRef(selected)
  const activeRef = useRef(active)
  activeRef.current = active
  selectedRef.current = selected

  async function loadSpace() {
    const value = await api('/subjects/' + subject.id)
    setSpace(value)
    return value
  }
  useEffect(() => { loadSpace().catch((e) => setError(e.message)) }, [subject.id])
  useEffect(() => {
    let disposed = false
    let timer
    setShowPending(false)
    async function load() {
      try {
        const value = await api('/conversations/' + selected)
        if (disposed) return
        if (value.subject !== subject.id) { setError('这个会话属于其他学科。'); return }
        setChat(value)
        if (value.turns.some((turn) => turn.status === 'running')) timer = setTimeout(load, 1000)
      } catch (e) { if (!disposed) setError(e.message) }
    }
    if (selected) load()
    return () => { disposed = true; clearTimeout(timer) }
  }, [selected, subject.id])
  const current = chat?.id === selected ? chat : null
  const learning = current?.learning || (selected ? null : space?.opening)
  const working = busy || current?.turns.some((turn) => turn.status === 'running')
  const feedback = current?.learning.followUp
  useEffect(() => {
    if (!feedback || feedback.failed || working || operation.current || resumedFeedback.current === feedback.key) return
    resumedFeedback.current = feedback.key
    run(() => continueFeedback(current.id, feedback.key), '老师正在接着讲…')
  }, [current?.id, feedback?.key, feedback?.failed, working])
  useEffect(() => {
    if (activeRef.current && (current?.learning.revision > 0 || busy)) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [current?.learning.revision, current?.turns.length, busy])
  useEffect(() => {
    if (!current || current.turns.length > 0 || working || operation.current) return
    const key = 'wenxue-pending-turn:' + current.id
    let queued = ''
    try { queued = sessionStorage.getItem(key) || '' } catch {}
    if (!queued || pendingAuto.current === current.id) return
    pendingAuto.current = current.id
    try { sessionStorage.removeItem(key) } catch {}
    send(queued, null, { targetId: current.id })
  }, [current?.id, current?.turns.length])

  async function makeConversation() {
    const value = await api('/subjects/' + subject.id + '/conversations', {})
    selectedRef.current = value.id
    onConversationChange?.(subject.id, value.id)
    setSpace((previous) => ({ ...previous, conversations: [value, ...previous.conversations] }))
    if (activeRef.current) location.hash = subjectLink(subject.id, value.id)
    return value.id
  }
  async function sync(id) {
    const value = await api('/conversations/' + id)
    if (selectedRef.current === id) setChat(value)
    await loadSpace()
    await refresh()
  }
  function handleStreamEvent(ev) {
    setLive((prev) => {
      const base = prev || { presentation: [], actions: [] }
      if (ev.type === 'text') {
        const last = base.presentation[base.presentation.length - 1]
        if (last?.type === 'text') return { ...base, presentation: [...base.presentation.slice(0, -1), { ...last, props: { text: last.props.text + ev.text } }] }
        return { ...base, presentation: [...base.presentation, { type: 'text', props: { text: ev.text } }] }
      }
      if (ev.type === 'component' && ev.block) {
        return { ...base, presentation: [...base.presentation, ev.block], actions: ev.action ? [...base.actions, ev.action] : base.actions }
      }
      return base
    })
  }
  async function executeNow(work, phaseText) {
    operation.current = true
    setBusy(true)
    setBusyPhase(phaseText)
    setError('')
    try { await work() } catch (e) {
      setError(e.message)
      if (e.status === 409 && selectedRef.current) await sync(selectedRef.current).catch(() => {})
    } finally {
      operation.current = false
      setBusy(false)
      setBusyPhase('')
      setLive(null)
      const next = queued.current.shift()
      if (next) setTimeout(() => executeNow(next.work, next.phaseText), 40)
    }
  }
  // 学生在老师回复期间随时可以提交；操作进入队列，当前回合结束后依序执行。
  function run(work, phaseText = '老师正在思考下一步引导…') {
    if (operation.current) {
      if (queued.current.length < 3) queued.current.push({ work, phaseText })
      return
    }
    return executeNow(work, phaseText)
  }
  async function newConversation() {
    return run(async () => {
      const id = await makeConversation()
      setDraft('')
      setAttachedImage(null)
      request.current = null
      eventRequest.current = null
      await sync(id)
    }, '正在开启新对话…')
  }
  async function streamTurn(id, body) {
    const response = await fetch('/api/conversations/' + id + '/turns/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(learnerId ? { 'X-Learner-Id': learnerId } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      let errData = {}
      try { errData = await response.json() } catch {}
      throw Object.assign(new Error(errData.error || '发送失败，请重试。'), { status: response.status })
    }
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      return await response.json()
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let turnId = null
    let doneTurn = null
    let streaming = false
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        let eventName = 'message'
        let dataText = ''
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataText += line.slice(5).trim()
        }
        if (!dataText) continue
        let parsed
        try { parsed = JSON.parse(dataText) } catch { continue }
        if (eventName === 'started' && parsed.turnId) turnId = parsed.turnId
        else if (eventName === 'text' && parsed.text) { streaming = true; handleStreamEvent({ type: 'text', text: parsed.text }) }
        else if (eventName === 'component' && parsed.block) { streaming = true; handleStreamEvent({ type: 'component', block: parsed.block, action: parsed.action }) }
        else if (eventName === 'stage' && parsed.message && !streaming) setBusyPhase(parsed.message)
        else if (eventName === 'done') doneTurn = parsed
      }
    }
    if (doneTurn) return doneTurn
    if (turnId) {
      for (let i = 0; i < 20; i++) {
        const recovered = await api('/turns/' + turnId)
        if (recovered.status !== 'running') return recovered
        await new Promise((r) => setTimeout(r, 700))
      }
    }
    return { status: 'running', id: turnId }
  }
  function handleDraftChange(instanceId, snapshot) {
    const convId = selectedRef.current
    if (!convId || !instanceId) return
    clearTimeout(draftTimers.current[instanceId])
    draftTimers.current[instanceId] = setTimeout(() => {
      if (selectedRef.current !== convId) return
      api('/conversations/' + convId + '/interactions/draft', { body: { instanceId, snapshot } }).catch(() => {})
    }, 250)
  }
  function handleHintRequest(layer) {
    const convId = selectedRef.current
    if (!convId) return
    api('/conversations/' + convId + '/hints', { body: { requestKey: crypto.randomUUID(), layer } }).catch(() => {})
  }
  async function resumeParentTask(taskId) {
    if (!selected) return
    return run(async () => {
      await api('/conversations/' + selected + '/tasks/resume', { body: { requestKey: crypto.randomUUID(), taskId } })
      await sync(selected)
    }, '正在返回主任务原题…')
  }
  async function startTopic(topicItem) {
    return run(async () => {
      const id = await makeConversation()
      setDraft('')
      setAttachedImage(null)
      setShowPending(false)
      setBusyPhase(`正在开启「${topicItem.title}」…`)
      await streamTurn(id, { prompt: topicItem.prompt, intent: 'teach', requestKey: crypto.randomUUID() })
      await sync(id)
    }, `正在开启「${topicItem.title}」…`)
  }
  async function send(text = draft, action, extra = {}) {
    const prompt = text.trim()
    const img = extra.image ?? (!action ? attachedImage : null)
    if (!prompt && !action && !img) return
    return run(async () => {
      const id = extra.targetId || selected || await makeConversation()
      const body = action
        ? { actionId: action.id, revision: learning.revision }
        : { prompt: prompt || '请看这张图，用学习模式一步步带我弄懂。', ...(img ? { image: img.dataUrl } : {}), ...(extra.intent ? { intent: extra.intent } : {}) }
      const fingerprint = JSON.stringify({ id, ...body })
      if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() }
      if (!action) setLocalSent({ prompt: prompt || '请看这张图，用学习模式一步步带我弄懂。', image: img })
      const response = await streamTurn(id, { ...body, requestKey: request.current.key })
      request.current = null
      if (!action) {
        setDraft((value) => value.trim() === prompt ? '' : value)
        if (img) setAttachedImage(null)
      }
      setShowPending(false)
      await sync(id)
      setLocalSent(null)
      if (response.status === 'failed') setError('老师这次未能完成回复，你的学习进度和已提交答案仍然保留，可以重试。')
    }, img ? '老师正在识别题目图片并准备分步引导…' : '老师正在思考…')
  }
  async function learningEvent(action, value, unsure = false) {
    return run(async () => {
      const id = selected || await makeConversation()
      let snapshot = learning
      if (!selected) snapshot = (await api('/conversations/' + id)).learning
      const issued = !selected ? snapshot.active.actions.find((a) => a.kind === action.kind) : action
      const body = { actionId: issued.id, revision: snapshot.revision, value, ...(unsure ? { unsure: true } : {}) }
      const fingerprint = JSON.stringify({ id, ...body })
      if (eventRequest.current?.fingerprint !== fingerprint) eventRequest.current = { fingerprint, key: crypto.randomUUID() }
      const eventResult = await api('/conversations/' + id + '/learning-events', { body: { ...body, requestKey: eventRequest.current.key } })
      eventRequest.current = null
      setShowPending(false)
      await sync(id)
      if (eventResult?.followUp) {
        await continueFeedback(id, eventResult.followUp.key)
      } else if (eventResult?.followUpPrompt) {
        setBusyPhase('老师正在根据你的回答调整下一步教学…')
        const followTurn = await streamTurn(id, {
          prompt: eventResult.followUpPrompt,
          intent: 'answer_followup',
          silentDisplay: true,
          requestKey: crypto.randomUUID(),
        })
        await sync(id)
        if (followTurn.status === 'failed') setError('你的回答已保存；老师暂时未完成点评，可直接输入继续对话。')
      }
    }, action.kind === 'answer.submit' ? '已收到回答，老师正在准备下一步…' : action.kind === 'exploration.submit' ? '已提交你的实验观察，老师正在点评…' : '正在更新学段…')
  }
  async function continueFeedback(id, key) {
    setBusyPhase('老师正在接着讲…')
    const response = await streamTurn(id, { followUp: true, requestKey: key })
    await sync(id)
    if (response.status === 'failed') setError('你的回答已保存，可以重试老师的点评。')
  }
  async function handleAttachFile(file) {
    if (!file) return
    setError('')
    try {
      setAttachedImage(await compressChatImage(file))
    } catch (e) {
      setError(e.message || '图片读取失败，请换一张。')
    }
  }
  function handlePaste(event) {
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (file) handleAttachFile(file)
        return
      }
    }
  }
  async function changeLevel(nextLevel) {
    if (working) return
    try {
      const goal = await api('/subjects/' + subject.id, { method: 'PATCH', body: { level: nextLevel, topic: space?.goal?.topic || '', ...(current ? { conversationId: current.id } : {}) } })
      setSpace((previous) => ({ ...previous, goal }))
      if (current) await sync(current.id)
      else await refresh()
    } catch (e) {
      setError(e.message)
    }
  }
  const items = current ? [
    ...current.messages.map((message) => ({ ...message, local: true, prompt: message.user_text })),
    ...current.turns,
  ].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || Number(!!b.local) - Number(!!a.local)) : []
  const instancesMap = Object.fromEntries((current?.interactionInstances || []).map((inst) => [inst.id, inst]))
  const responseProps = { busy: working, onEvent: learningEvent, onTeacher: (action) => send('', action), onQuickPrompt: (text) => send(text), instancesMap, onDraftChange: handleDraftChange, onHintRequest: handleHintRequest }
  const pendingHidden = learning?.pending && !learning.active.presentation.some((b) => b.props.questionId === learning.pending.props.questionId)
  const topics = space?.subject?.topics || subject.topics || []
  const dueReviews = space?.dueReviews || []

  return <div className={'subject-workspace ' + (sidebarOpen ? 'with-history' : '')}>
    {space && <div className="study-layout guided-layout">
      <section className="panel chat-panel">
        <div className="chat-head">
          <button className="icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label={sidebarOpen ? '收起学习导航' : '展开学习导航'}>{sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</button>
          <div className="chat-head-title">
            <strong>{learning?.topic || space?.goal.topic || subject.name}</strong>
            <select className="level-inline-select" aria-label="学习阶段" value={learning?.level || space.goal?.level || ''} disabled={working} onChange={(e) => changeLevel(e.target.value)}>
              <option value="">学段：自适应</option>
              {learning?.level && !levels.includes(learning.level) && <option value={learning.level}>{learning.level}</option>}
              {levels.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </div>
        </div>
        <Notice text={error} />
        {feedback && <button className="text-button" disabled={working} onClick={() => run(() => continueFeedback(current.id, feedback.key), '老师正在接着讲…')}>{feedback.failed ? '重试老师的点评' : '继续老师的点评'}</button>}
        {current?.taskTree?.activePath?.length > 1 && <div className="task-stack-banner" role="region" aria-label="前置补习任务栈">
          <div className="task-stack-path">
            <Layers size={15} />
            <span>任务栈：{current.taskTree.activePath.map((t) => t.title).join(' › ')}</span>
          </div>
          <button type="button" className="button secondary compact" disabled={working} onClick={() => resumeParentTask(current.taskTree.activeTask?.id)}>
            <CornerDownLeft size={14} />返回主任务原题
          </button>
        </div>}
        {config.mode === 'demo' && <div className="teaching-demo-note">离线交互预览 · 示例回复用于体验操作，真实带学需连接模型。</div>}
        <div className="messages guided-messages" aria-busy={working}>
          {current?.homework && <details className="homework-source" open={current.homework.edited}><summary>正在学习的作业{current.homework.edited ? ' · 原题已修正，旧批改失效' : ''}</summary><p>{current.homework.text}</p><p>原来的答案：{current.homework.student_answer || '未识别到答案'}</p><a href={'#/homework/' + subject.id}>返回作业核对原图</a></details>}
          {selected && !current && <p className="muted">正在接上你的学习进度…</p>}
          {!selected && learning && <TeacherMessage><LearningResponse response={learning.active} interactive {...responseProps} /></TeacherMessage>}
          {items.map((item) => {
            const active = item.presentation?.responseId === learning?.active.responseId
            return <div className="turn lesson-turn" key={item.id}>
              {(item.prompt || item.user_image) && <div className="user-message">
                {item.user_image && <img className="user-message-image" src={item.user_image} alt="上传的学习图片" />}
                {item.prompt && <div>{item.prompt}</div>}
              </div>}
              {item.presentation ? <TeacherMessage><LearningResponse response={active ? learning.active : item.presentation} interactive={active} {...responseProps} /></TeacherMessage> : item.reply && <TeacherMessage><p className="legacy-reply">{item.reply}</p></TeacherMessage>}
              {item.status === 'running' && <div className="thinking-indicator" role="status"><span className="thinking-dots"><i /><i /><i /></span><span>{busyPhase || '老师正在根据你的回答思考下一步…'}</span></div>}
              {item.status === 'failed' && <div className="failed-message">本次回复未完成，已有学习进度已保留。<button className="text-button" disabled={working} onClick={() => setDraft(item.prompt)}>重新发送</button></div>}
            </div>
          })}
          {pendingHidden && <div className="resume-question"><button className="text-button" onClick={() => setShowPending(!showPending)}><CornerDownLeft size={16} />{showPending ? '收起原练习' : '回到刚才的练习'}</button><p className="muted">{learning.pending.props.prompt}</p>{showPending && <LearningResponse key={learning.revision} response={{ ...learning.active, presentation: [learning.pending], actions: learning.active.actions.filter((a) => a.kind === 'answer.submit') }} interactive {...responseProps} />}</div>}
          {localSent && <div className="turn lesson-turn"><div className="user-message">{localSent.image && <img className="user-message-image" src={localSent.image.dataUrl} alt="上传的学习图片" />}{localSent.prompt && <div>{localSent.prompt}</div>}</div></div>}
          {busy && live && live.presentation.length > 0 && <div className="turn lesson-turn streaming-turn">
            <TeacherMessage badge="正在回复">
              <LearningResponse response={live} streaming {...responseProps} />
              <span className="typing-caret" aria-hidden="true" />
            </TeacherMessage>
          </div>}
          {busy && (!live || live.presentation.length === 0) && <div className="thinking-indicator" role="status"><span className="thinking-dots"><i /><i /><i /></span><span>{busyPhase || '老师正在思考…'}</span></div>}
          <div ref={bottom} />
        </div>
        <form className="composer" onSubmit={(event) => { event.preventDefault(); send() }}>
          {attachedImage && <div className="composer-attachment">
            <img src={attachedImage.dataUrl} alt="待发送题目图" />
            <span>{attachedImage.name}</span>
            <button type="button" className="icon-button" aria-label="移除图片" onClick={() => setAttachedImage(null)}><X size={15} /></button>
          </div>}
          <div className="composer-field">
            <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { handleAttachFile(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" className="icon-button attach-button" title="上传或粘贴题目图片" aria-label="上传题目图片" onClick={() => imageInput.current?.click()}><ImageIcon size={18} /></button>
            <textarea
              aria-label="学习问题"
              placeholder={working ? '老师正在回复，可以先输入，发送后将依次进行…' : learning?.pending ? '可以继续提问，也可以直接作答…（Enter 发送）' : (current?.turns.length || current?.messages.length) ? '继续提问，或者输入新的问题…（Enter 发送）' : `今天想学什么？例如「${subject.example}」（Enter 发送）`}
              rows={2}
              maxLength={4000}
              value={draft}
              onPaste={handlePaste}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  const live = e.currentTarget.value
                  if ((live.trim() || attachedImage) && !(selected && !current)) send(live)
                }
              }}
            />
            <button className="button primary" type="submit" aria-label="发送问题" disabled={(!draft.trim() && !attachedImage) || Boolean(selected && !current)}><Send size={17} /></button>
          </div>
        </form>
      </section>
      <aside className="study-side" hidden={!sidebarOpen} aria-label={subject.name + '学习导航'}>
        <div className="side-top">
          <select className="subject-jump" aria-label="切换学科" value={subject.id} onChange={(e) => { location.hash = subjectLink(e.target.value) }}>
            {(subjects.length ? subjects : [subject]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" className="new-chat-btn" onClick={newConversation} disabled={working || Boolean(selected && !current)}><Plus size={16} />新对话</button>
        </div>
        {topics.length > 0 && <details className="side-block side-topics">
          <summary><BookOpen size={14} />课程专题</summary>
          <ul className="nav-topics">{topics.map((t) => <li key={t.title}><button type="button" className={learning?.topic === t.title ? 'active-topic' : ''} disabled={working} onClick={() => startTopic(t)}>{t.title}</button></li>)}</ul>
        </details>}
        <section className="side-block side-history">
          <h2><MessageCircle size={14} />学习记录</h2>
          {space.conversations.length ? <ul className="history">{space.conversations.map((item) => <li key={item.id}><a href={subjectLink(subject.id, item.id)} aria-current={selected === item.id ? 'page' : undefined}>{item.title}</a></li>)}</ul> : <p className="muted">开始对话后自动保存，下次可接着学。</p>}
        </section>
        <div className="side-foot">
          <a href={'#/homework/' + subject.id}><Clock3 size={14} />拍作业 · 待复习{dueReviews.length ? `（${dueReviews.length}）` : ''}</a>
          <button type="button" className="icon-button side-close" aria-label="关闭学习导航" onClick={() => setSidebarOpen(false)}><X size={16} /></button>
        </div>
      </aside>
    </div>}
  </div>
}
