import React, { useEffect, useState } from 'react'
import { api, Notice, useLearnerApi } from './ui.jsx'

export function FamilySettings({ learners, selected, onUpdate, onSelect }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(event, id) {
    event.preventDefault()
    const name = new FormData(event.currentTarget).get('name')
    setBusy(true); setError('')
    try {
      const child = await api(id ? '/learners/' + id : '/learners', { method: id ? 'PATCH' : 'POST', body: { name } })
      await onUpdate()
      if (!id) onSelect(child.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="homework-page family-page"><h1>孩子档案</h1><p className="muted">同一家长账号下，各个孩子的作业、会话和学习记录分别保存。学习阶段在各学科里设置。</p><Notice text={error} />
    {learners.map((child) => <form className="child-row" key={child.id} onSubmit={(e) => save(e, child.id)}><label>孩子的称呼<input name="name" defaultValue={child.name} maxLength={30} required /></label><button className="button secondary" disabled={busy}>保存称呼</button><button className="text-button" type="button" disabled={child.id === selected || busy} onClick={() => onSelect(child.id)}>{child.id === selected ? '当前档案' : '切换到这个孩子'}</button></form>)}
    <form className="child-row" onSubmit={(e) => save(e)}><label>添加孩子<input name="name" placeholder="填写孩子的称呼" maxLength={30} required /></label><button className="button primary" disabled={busy || learners.length >= 8}>添加档案</button></form>
  </div>
}

export function FamilyProgress({ refreshKey }) {
  const api = useLearnerApi()
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { let live = true; api('/homework/report').then((r) => { if (live) { setReport(r); setError('') } }).catch((e) => { if (live) setError(e.message) }); return () => { live = false } }, [api, refreshKey])
  const totals = report?.subjects.reduce((a, s) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + s[k]])), { total: 0, wrong: 0, uncertain: 0, due: 0, reflected: 0 })
  return <section className="family-progress"><header><div><h2>作业与复习</h2><p>从实际作业发现问题，再回到学科里弄懂。</p></div><a className="button secondary" href="#/homework">拍作业 / 查看记录</a></header><Notice text={error} />{totals && <><div className="family-evidence"><div><strong>{totals.total}</strong><span>已识别题目</span></div><div><strong>{totals.wrong}</strong><span>AI 建议巩固</span></div><div><strong>{totals.uncertain}</strong><span>判定待核对</span></div><div><strong>{totals.due}</strong><span>到期复习</span></div><div><strong>{totals.reflected}</strong><span>已提交复习记录</span></div></div><p className="muted">{totals.total ? report.note : '拍一份作业来，或直接进入学科自主学习。两种方式都会留下这个孩子的学习记录。'}</p></>}</section>
}
