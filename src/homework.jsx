import React, { useContext, useEffect, useRef, useState } from 'react'
import { Camera, ArrowRight, Image as ImageIcon, RotateCcw, X } from 'lucide-react'
import { LearnerContext, Notice, subjectLink, useLearnerApi } from './ui.jsx'
const levels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']

// Browser-side compression mirrors the homework project's intake flow. Errors remain visible.
async function preparePhoto(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error('原图超过 12 MB，请先缩小图片。')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2200 / bitmap.width, 3000 / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const image = canvas.toDataURL('image/jpeg', .88)
  if (image.length > 7_000_000) throw new Error('照片压缩后仍过大，请分开拍摄。')
  return { id: crypto.randomUUID(), name: file.name, image, submitted: false }
}
const verdicts = { correct: 'AI 判为正确', wrong: 'AI 建议巩固', uncertain: '暂不能确定' }
const statuses = { queued: '等待批改', running: '正在批改', completed: '批改完成', failed: '批改未完成' }

function Question({ item, reload, onLearn, busy }) {
  const api = useLearnerApi()
  const [editing, setEditing] = useState(false)
  const [reflecting, setReflecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const reflectKey = useRef(null)
  async function submit(event, kind) {
    event.preventDefault(); setError(''); setNotice(''); setSaving(true)
    const body = Object.fromEntries(new FormData(event.currentTarget))
    try {
      if (kind === 'edit') {
        await api('/homework/questions/' + item.id, { method: 'PATCH', body: { ...body, revision: item.revision } })
        setEditing(false)
      } else {
        if (reflectKey.current?.text !== body.text) reflectKey.current = { text: body.text, key: crypto.randomUUID() }
        const r = await api('/homework/questions/' + item.id + '/reflect', { body: { text: body.text, requestKey: reflectKey.current.key } })
        reflectKey.current = null; setNotice(r.note); setReflecting(false)
      }
      await reload()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }
  return <article className="homework-question">
    <header><strong>第 {item.number} 题</strong><span className={'verdict ' + item.verdict}>{verdicts[item.verdict]}</span>{item.edited && <small>题目已修正</small>}</header>
    <p className="question-text">{item.text}</p><p className="student-answer"><span>原来的答案</span>{item.student_answer || '未识别到答案'}</p>
    <details><summary>查看批改依据与参考答案</summary><p>{item.correct_answer || '需要结合题目进一步核对'}</p><p>{item.explanation}</p>{item.knowledge_hint && <small>建议关注：{item.knowledge_hint}（尚未匹配标准知识点）</small>}</details>
    <div className="question-actions"><button className="button primary compact" disabled={busy || saving} onClick={() => onLearn(item)}>{item.conversation_id ? '继续跟老师学' : '跟老师弄懂'}<ArrowRight size={15} /></button><button className="text-button" disabled={saving} onClick={() => { setEditing(!editing); setReflecting(false) }}>识别有误？修正</button><button className="text-button" disabled={saving} onClick={() => { setReflecting(!reflecting); setEditing(false) }}>记录独立复习</button></div>
    {item.due_at && <small className="review-date">{new Date(item.due_at) <= new Date() ? '到期了，可以再独立试一遍' : '下次回顾：' + new Date(item.due_at).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}{item.last_submitted_at ? ' · 已有复习提交，不代表已掌握' : ''}</small>}
    <Notice text={error} />{notice && <p role="status" className="inline-success">{notice}</p>}
    {editing && <form className="question-edit" onSubmit={(e) => submit(e, 'edit')}><label>核对题干<textarea name="text" defaultValue={item.text} maxLength={6000} required rows={3} /></label><label>孩子原来的答案<textarea name="studentAnswer" defaultValue={item.student_answer} maxLength={3000} rows={2} /></label><p className="muted">修正后原批改结论失效，由学科老师结合新题继续核对。</p><button className="button secondary" disabled={saving}>保存修正</button></form>}
    {reflecting && <form className="question-edit" onSubmit={(e) => submit(e, 'reflect')}><label>不看解析，再写一次答案和思路<textarea name="text" maxLength={3000} required rows={3} /></label><p className="muted">保存为你的作答记录；之后可以让老师继续核对。</p><button className="button secondary" disabled={saving}>保存复习记录</button></form>}
  </article>
}

export function Homework({ subjects, initialSubject, config, refresh }) {
  const api = useLearnerApi()
  const learnerId = useContext(LearnerContext)
  const [subject, setSubject] = useState(initialSubject || 'math')
  const [level, setLevel] = useState(subjects.find((s) => s.id === (initialSubject || 'math'))?.level || '')
  const [photos, setPhotos] = useState([])
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preview, setPreview] = useState(null)
  const active = useRef(true)
  const previewUrl = useRef(null)
  const fileInput = useRef(null)
  const camera = useRef(null)
  const retryKeys = useRef(new Map())
  useEffect(() => { active.current = true; return () => { active.current = false; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) } }, [])
  async function load() {
    const value = await api('/homework?subject=' + subject)
    if (active.current) setData(value)
    return value
  }
  useEffect(() => {
    let disposed = false, timer, previousStatus = ''
    setData(null)
    async function poll() {
      try {
        const value = await api('/homework?subject=' + subject)
        if (disposed) return
        setData(value)
        const status = value.pages.map((p) => p.id + ':' + p.status).join(',')
        if (status !== previousStatus) await refresh()
        previousStatus = status
        timer = setTimeout(poll, 2500)
      } catch (e) { if (!disposed) setError(e.message) }
    }
    poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [subject, api])
  async function add(files) {
    setError(''); setPreparing(true)
    try {
      if (photos.length + files.length > 12) throw new Error('一次最多选择 12 页。')
      const ready = await Promise.all(Array.from(files).map(preparePhoto))
      if (active.current) setPhotos((previous) => [...previous, ...ready])
    } catch (e) { setError(e.message || '照片读取失败，请换一张。') } finally { setPreparing(false) }
  }
  async function upload() {
    setBusy(true); setError('')
    try {
      for (const photo of photos.filter((p) => !p.submitted)) {
        if (!active.current) break
        await api('/homework/pages', { body: { requestKey: photo.id, subject, level, image: photo.image } })
        setPhotos((old) => old.map((p) => p.id === photo.id ? { ...p, submitted: true } : p))
        await load(); await refresh()
      }
    } catch (e) { setError(e.message + ' 已提交的页面会继续处理，未提交照片保留在这里。') } finally { setBusy(false) }
  }
  async function learn(q) {
    setBusy(true); setError('')
    try { const c = await api('/homework/questions/' + q.id + '/learn', {}); await refresh(); if (active.current) location.hash = subjectLink(c.subject, c.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function retry(page) {
    setBusy(true); setError('')
    if (!retryKeys.current.has(page.id)) retryKeys.current.set(page.id, crypto.randomUUID())
    try { await api('/homework/pages/' + page.id + '/retry', { body: { requestKey: retryKeys.current.get(page.id) } }); retryKeys.current.delete(page.id); await load(); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function image(page) {
    setError('')
    try {
      const response = await fetch('/api/homework/pages/' + page.id + '/image', { headers: { 'X-Learner-Id': learnerId } })
      if (!response.ok) throw new Error('原图加载失败，请重试。')
      const blob = await response.blob()
      if (!active.current) return
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = URL.createObjectURL(blob); setPreview(previewUrl.current)
    } catch (e) { setError(e.message) }
  }
  const pending = photos.filter((p) => !p.submitted).length
  const questions = data?.questions.filter((q) => filter === 'all' || (filter === 'wrong' ? q.verdict === 'wrong' : q.due_at && new Date(q.due_at) <= new Date())) || []
  return <div className="homework-page"><div className="homework-heading"><div><h1>作业与错题</h1><p>拍下来，先核对，再交给这门课的老师一起弄懂。</p></div><a className="button secondary" href={subjectLink(subject)}>自主学习<ArrowRight size={16} /></a></div>
    <section className="homework-intake"><div className="intake-options"><label>作业学科<select value={subject} disabled={busy || preparing || pending > 0} onChange={(e) => { setSubject(e.target.value); setLevel(subjects.find((s) => s.id === e.target.value)?.level || '') }}>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>本次作业阶段<select value={level} disabled={busy || photos.length > 0} onChange={(e) => setLevel(e.target.value)}><option value="">根据题目判断</option>{levels.map((l) => <option key={l}>{l}</option>)}</select></label><div className="intake-buttons"><button className="button secondary" disabled={busy || preparing || !config.homework.enabled} onClick={() => camera.current.click()}><Camera size={17} />拍照</button><button className="button secondary" disabled={busy || preparing || !config.homework.enabled} onClick={() => fileInput.current.click()}><ImageIcon size={17} />选择照片</button></div></div>
      <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} /><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      <p className="muted">{config.homework.enabled ? '支持上传或拍摄作业照片，识别批改后可一键带入对应学科，由导师用学习模式一步步引导弄懂。' : '图片批改尚未配置。可以先进入学科自主学习，作业入口会在配置后启用。'}</p>
      {preparing && <p role="status">正在压缩照片…</p>}
      {photos.length > 0 && <><div className="photo-strip">{photos.map((p, i) => <div key={p.id}><img src={p.image} alt={'待提交作业第 ' + (i + 1) + ' 页'} /><small>{p.submitted ? '已提交' : '第 ' + (i + 1) + ' 页'}</small><button aria-label={'移除第 ' + (i + 1) + ' 页'} disabled={busy} onClick={() => setPhotos((old) => old.filter((x) => x.id !== p.id))}><X size={14} /></button></div>)}</div><button className="button primary" onClick={upload} disabled={busy || preparing || !pending}>{busy ? '正在提交…' : pending ? `提交 ${pending} 页作业` : '照片已全部提交'}</button></>}
    </section><Notice text={error} />
    {preview && <section className="homework-preview"><button className="button secondary" onClick={() => setPreview(null)}>收起原图</button><img src={preview} alt="作业原图，可对照核对识别结果" /></section>}
    <nav className="homework-filters" aria-label="作业记录筛选">{[['all', '全部作业'], ['wrong', '错题巩固'], ['review', '到期复习']].map(([v, label]) => <button key={v} className={filter === v ? 'selected' : ''} onClick={() => setFilter(v)} aria-pressed={filter === v}>{label}</button>)}<button className="text-button" onClick={() => load().catch((e) => setError(e.message))}><RotateCcw size={14} />刷新</button></nav>
    {!data && <p className="muted">正在读取作业记录…</p>}
    {data && !data.pages.length && <div className="homework-empty"><Camera size={28} /><h2>把今天的作业带来</h2><p>先选择学科并上传照片，也可以直接进入学科，让老师安排第一步。</p></div>}
    {data?.pages.map((page) => { const items = questions.filter((q) => q.page_id === page.id); if (filter !== 'all' && !items.length) return null; return <section className="homework-sheet" key={page.id}><header><div><strong>{subjects.find((s) => s.id === page.subject)?.name}作业</strong><small>{new Date(page.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}{page.level ? ' · ' + page.level : ''}</small></div><span>{statuses[page.status]}</span><button className="text-button" onClick={() => image(page)}>查看原图</button></header>{['queued', 'running'].includes(page.status) && <p role="status" className="sheet-note">照片已保存，正在识别批改中，刷新页面也能接着查看。</p>}{page.status === 'failed' && <div className="sheet-note"><Notice text={page.error} /><button className="button secondary" disabled={busy} onClick={() => retry(page)}>重试这一页</button></div>}{items.map((q) => <Question key={q.id + ':' + q.revision} item={q} reload={load} onLearn={learn} busy={busy} />)}</section> })}
    {data?.pages.length > 0 && filter !== 'all' && !questions.length && <p className="homework-empty">{filter === 'review' ? '当前没有到期复习。学习过的作业会安排后续回顾，也可以随时主动复习。' : '当前记录中没有 AI 建议巩固的题目，仍可查看全部作业和待核对项。'}</p>}
    {data && <p className="muted">显示本学科最近 60 页、最多 300 道题；批改结果可修正，未据此生成能力评分。</p>}
  </div>
}
