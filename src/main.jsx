import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, BookOpen, Compass } from 'lucide-react'
import { LearningWorkspace, ProgressOverview } from './workspace.jsx'
import { api, LearnerContext, Notice } from './ui.jsx'
import { FamilySettings } from './family.jsx'
import { Homework } from './homework.jsx'
import { CatalogView } from './catalog.jsx'
import { ProgressView } from './progress.jsx'
import { QualityView } from './quality.jsx'
import './styles.css'
import './workspace.css'
import './homework.css'
function Brand() {
  return <a className="brand" href="#/"><span className="brand-mark"><Compass size={23} /></span><span>问学<small>学习工作台</small></span></a>
}

function Login({ config, onLogin }) {
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(endpoint, body) {
    setBusy(true)
    setError('')
    try {
      onLogin(await api(endpoint, { body }))
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }
  return <main className="login">
    <div className="login-story">
      <Brand />
      <div className="story-body">
        <div className="story-icon"><BookOpen size={36} /></div>
        <h1>每一步<br />都有老师带着学</h1>
        <p>拍作业、弄懂错题、自主学习。各科进度，连在同一本学习记录里。</p>
        <div className="story-lines" aria-hidden="true"><i /><i /><i /></div>
      </div>
    </div>
    <section className="login-panel">
      <div className="login-form">
        <h2>{register ? '创建家长账号' : '登录问学'}</h2>
        <p className="muted">{register ? '一个账号管理孩子档案，记录作业与自主学习。' : '回到孩子的学习记录，接着上次的进度。'}</p>
        <form onSubmit={(event) => {
          event.preventDefault()
          submit(register ? '/register' : '/login', Object.fromEntries(new FormData(event.currentTarget)))
        }}>
          {register && <label>昵称<input name="name" autoComplete="nickname" maxLength={30} required /></label>}
          <label>邮箱<input name="email" type="email" autoComplete="email" required /></label>
          <label>密码<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} maxLength={128} required /></label>
          <Notice text={error} />
          <button className="button primary wide" disabled={busy}>{register ? '创建账号' : '登录'} <ArrowRight size={17} /></button>
        </form>
        <button className="text-button" onClick={() => { setError(''); setRegister(!register) }}>{register ? '已有账号，去登录' : '还没有账号？注册'}</button>
      </div>
    </section>
  </main>
}

function readRoute() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
}

function App() {
  const [route, setRoute] = useState(readRoute)
  const [account, setAccount] = useState(undefined)
  const [config, setConfig] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [learners, setLearners] = useState([])
  const [learnerId, setLearnerId] = useState('')
  const activeLearner = useRef('')
  activeLearner.current = learnerId
  useEffect(() => {
    const update = () => { setRoute(readRoute()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => {
    api('/config').then(setConfig).catch((error) => setError(error.message))
    api('/me').then(setAccount).catch((error) => {
      if (error.status === 401) setAccount(null)
      else setError(error.message)
    })
  }, [])
  async function refresh() {
    const target = learnerId
    if (!target) return
    try {
      const next = await api('/dashboard', undefined, target)
      if (activeLearner.current !== target) return
      setData(next)
      setError('')
    } catch (error) {
      if (error.status === 401) { setAccount(null); setData(null) }
      else setError(error.message)
    }
  }
  useEffect(() => {
    if (account && learnerId) refresh()
  }, [account, learnerId, route[0]])
  async function loadLearners() {
    const children = await api('/learners')
    setLearners(children)
    return children
  }
  useEffect(() => {
    if (!account) return
    let live = true
    loadLearners().then((children) => {
      if (!live) return
      let saved
      try { saved = sessionStorage.getItem('wenxue-child:' + account.id) } catch { setError('浏览器无法保存孩子选择，刷新后会回到默认档案。') }
      setLearnerId(children.some((c) => c.id === saved) ? saved : children[0]?.id || '')
    }).catch((e) => setError(e.message))
    return () => { live = false }
  }, [account])
  function selectLearner(id) {
    if (id === learnerId) return
    activeLearner.current = id
    setData(null); setLearnerId(id)
    try { sessionStorage.setItem('wenxue-child:' + account.id, id) } catch { setError('本次已切换，但浏览器无法保存选择，刷新后会回到默认档案。') }
    location.hash = '#/'
  }
  async function logout() {
    try {
      await api('/logout', {})
      setAccount(null)
      setData(null)
      setLearnerId(''); setLearners([])
      location.hash = '#/'
    } catch (error) {
      setError(error.message)
    }
  }

  if (account === undefined || !config) return <main className="loading"><Notice text={error} />{!error && '正在打开工作台…'}</main>
  if (!account) return <Login config={config} onLogin={setAccount} />
  if (!learnerId) return <main className="loading"><Notice text={error} />正在读取孩子档案…</main>
  return <LearnerContext.Provider value={learnerId}><LearningWorkspace key={account.id + ':' + learnerId} account={account} learnerId={learnerId} learners={learners} onSelectLearner={selectLearner} route={route} data={data} config={config} refresh={refresh} onLogout={logout} error={error} overview={data && <ProgressOverview data={data} />} catalog={data && <CatalogView data={data} />} progress={data && <ProgressView data={data} refresh={refresh} />} quality={<QualityView />} homework={data && <Homework key={learnerId + ':' + (route[1] || '')} subjects={data.subjects} initialSubject={route[1]} config={config} refresh={refresh} />} family={<FamilySettings learners={learners} selected={learnerId} onUpdate={loadLearners} onSelect={selectLearner} />} /></LearnerContext.Provider>
}

createRoot(document.getElementById('root')).render(<App />)
