import React, { useEffect, useRef, useState } from 'react'
import { ArrowRight, Compass, LogOut, Menu, Send, Sparkles } from 'lucide-react'
import { SubjectView } from './subject.jsx'
import { Notice, SubjectIcon, subjectLink, useLearnerApi } from './ui.jsx'

export function ProgressOverview({ data }) {
  const api = useLearnerApi()
  const [question, setQuestion] = useState('')
  const [subjectPick, setSubjectPick] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const recent = data.subjects.filter((s) => s.conversation_id).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
  const examples = data.subjects.slice(0, 4)

  async function startNaturalStudy(text = question, forcedSubject = subjectPick) {
    const prompt = text.trim()
    if (!prompt || starting) return
    setStarting(true)
    setError('')
    try {
      const created = await api('/study/start', { body: { prompt, ...(forcedSubject ? { subject: forcedSubject } : {}) } })
      try { sessionStorage.setItem('wenxue-pending-turn:' + created.id, prompt) } catch {}
      setQuestion('')
      location.hash = subjectLink(created.subject, created.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setStarting(false)
    }
  }

  return <div className="home-hero">
    <div className="home-hero-inner">
      <span className="hybrid-badge"><Sparkles size={13} />AI 学习教室</span>
      <h1>今天想学什么？</h1>
      <Notice text={error} />
      <form className="home-composer" onSubmit={(e) => { e.preventDefault(); startNaturalStudy() }}>
        <select aria-label="自动识别或指定学科" value={subjectPick} onChange={(e) => setSubjectPick(e.target.value)} disabled={starting}>
          <option value="">智能识别学科</option>
          {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          type="text"
          aria-label="今天想学什么"
          placeholder="直接问一个问题、发一道不会的题，或说一个想学的知识点…"
          maxLength={4000}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={starting}
          autoFocus
        />
        <button className="send-orb" aria-label="开始学习" disabled={!question.trim() || starting}><Send size={17} /></button>
      </form>
      <div className="home-examples">
        {examples.map((s) => <button key={s.id} type="button" disabled={starting} onClick={() => startNaturalStudy(s.topics?.[0]?.prompt || `我想学${s.name}`, s.id)}>{s.topics?.[0]?.title || `学点${s.name}`}</button>)}
      </div>
      {recent && <a className="home-resume" href={subjectLink(recent.id, recent.conversation_id)}>
        <SubjectIcon subject={recent} />
        <span className="home-resume-text"><small>继续上次学习</small><strong>{recent.topic || recent.name}</strong><span>{[recent.name, recent.level].filter(Boolean).join(' · ')}</span></span>
        <ArrowRight size={18} />
      </a>}
    </div>
  </div>
}

function readSaved(accountId) {
  try { return JSON.parse(sessionStorage.getItem('wenxue-tabs:' + accountId)) || {} } catch { return {} }
}

const routeTitles = { catalog: '课程目录', progress: '学习档案', quality: '质量评测', homework: '拍作业', family: '孩子档案' }
const menuItems = [
  ['catalog', '课程目录'],
  ['progress', '学习档案'],
  ['homework', '拍作业'],
  ['family', '孩子档案'],
  ['quality', '质量评测'],
]

export function LearningWorkspace({ account, learnerId, learners, onSelectLearner, route, data, config, refresh, onLogout, error, overview, catalog, progress, quality, homework, family }) {
  const storageId = account.id + ':' + learnerId
  const [selectedSessions, setSelectedSessions] = useState(() => readSaved(storageId))
  const [storageError, setStorageError] = useState('')
  const [visited, setVisited] = useState([])
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const current = route[0] === 'subject' ? route[1] : null
  const subjects = data?.subjects || []
  const shown = new Set([...visited, ...(current ? [current] : [])])

  useEffect(() => {
    if (!current || !subjects.some((s) => s.id === current)) return
    setVisited((old) => old.includes(current) ? old : [...old, current])
    if (route[2]) setSelectedSessions((old) => {
      if (old[current] === route[2]) return old
      const next = { ...old, [current]: route[2] }
      try { sessionStorage.setItem('wenxue-tabs:' + storageId, JSON.stringify(next)) } catch { setStorageError('浏览器无法保存标签选择；会话仍已保存，可从本学科历史继续。') }
      return next
    })
  }, [current, route[2], data, account.id])
  useEffect(() => {
    document.title = (subjects.find((s) => s.id === current)?.name || routeTitles[route[0]] || '问学') + ' · 问学'
  }, [current, route[0], data])
  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const special = ['catalog', 'progress', 'quality', 'homework', 'family'].includes(route[0])
  const currentTitle = current ? (subjects.find((s) => s.id === current)?.name || '') : (special ? routeTitles[route[0]] : '')

  return <div className="app-shell">
    <header className="top-bar">
      <a className="top-brand" href="#/"><Compass size={20} /><strong>问学</strong></a>
      <span className="top-context">{currentTitle}</span>
      <div className="top-actions">
        <select className="child-switch" aria-label="当前孩子" value={learnerId} onChange={(e) => onSelectLearner(e.target.value)}>{learners.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select>
        <div className="top-menu" ref={menuRef}>
          <button className="icon-button" aria-label="更多功能" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Menu size={19} /></button>
          {menuOpen && <div className="top-menu-pop" role="menu">
            {menuItems.map(([id, label]) => <a key={id} role="menuitem" href={'#/' + id} onClick={() => setMenuOpen(false)}>{label}</a>)}
            {config.mode === 'demo' && <span className="menu-note">交互预览模式</span>}
            <button role="menuitem" className="menu-danger" onClick={() => { setMenuOpen(false); onLogout() }}><LogOut size={15} />退出登录</button>
          </div>}
        </div>
      </div>
    </header>
    <main className="app-body">
      {(error || storageError) && <div className="workspace-error"><Notice text={error || storageError} /></div>}
      {!data && !error && <div className="loading">正在读取学习记录…</div>}
      <section className="overview-pane" hidden={!!current || special}>{overview}</section>
      {route[0] === 'catalog' && <section className="overview-pane">{catalog}</section>}
      {route[0] === 'progress' && <section className="overview-pane">{progress}</section>}
      {route[0] === 'quality' && <section className="overview-pane">{quality}</section>}
      {route[0] === 'homework' && <section className="overview-pane">{homework}</section>}
      {route[0] === 'family' && <section className="overview-pane">{family}</section>}
      {subjects.filter((s) => shown.has(s.id)).map((subject) => <section key={subject.id} hidden={current !== subject.id} className="subject-pane"><SubjectView subject={subject} subjects={subjects} active={current === subject.id} conversationId={current === subject.id ? route[2] || selectedSessions[subject.id] : selectedSessions[subject.id]} config={config} refresh={refresh} onConversationChange={rememberSession(selectedSessions, setSelectedSessions, storageId)} /></section>)}
      {current && data && !subjects.some((s) => s.id === current) && <div className="loading">未找到这个学科。</div>}
    </main>
  </div>
}

// Persist the last visited conversation per subject without re-creating handlers on every render.
function rememberSession(selectedSessions, setSelectedSessions, storageId) {
  return (subjectId, id) => setSelectedSessions((old) => {
    if (old[subjectId] === id) return old
    const next = { ...old, [subjectId]: id }
    try { sessionStorage.setItem('wenxue-tabs:' + storageId, JSON.stringify(next)) } catch {}
    return next
  })
}
