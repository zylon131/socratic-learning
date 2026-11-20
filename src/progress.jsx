import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, Download, FileText, ShieldCheck, Sparkles, Trash2 } from 'lucide-react'
import { Notice, subjectLink, useLearnerApi } from './ui.jsx'

const stateMap = {
  unobserved: { label: '未接触', cls: 'state-unobserved' },
  emerging: { label: '待验证', cls: 'state-emerging' },
  understood: { label: '已理解', cls: 'state-understood' },
  validated: { label: '已迁移验证', cls: 'state-validated' },
  review_needed: { label: '建议巩固', cls: 'state-review' },
}

const sourceLabel = {
  rule_engine: '确定性规则引擎',
  teacher_probe: '苏格拉底追问',
  transfer_task: '新情境迁移练习',
  llm_semantic: '通用语义评估',
  self_report: '自主探索提交',
}

const formatConfidence = (c) => {
  const num = Number(c || 0)
  return num >= 0.8 ? '证据充分' : num >= 0.5 ? '初步可信' : '待加强确认'
}

export function ProgressView({ data, refresh }) {
  const api = useLearnerApi()
  const [archive, setArchive] = useState(null)
  const [showUnobserved, setShowUnobserved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState('')

  async function load() {
    const res = await api('/progress')
    setArchive(res)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [data?.learner?.id])

  async function updateRecommendation(rec, status) {
    setError('')
    try {
      await api('/recommendations/' + rec.id, { method: 'PATCH', body: { status } })
      await load()
      if (status === 'accepted' && rec.skill_id) {
        const title = archive?.definitions?.find((d) => d.id === rec.skill_id)?.title || rec.skill_id
        const prompt = `我想巩固「${title}」`
        const created = await api('/study/start', { body: { subject: rec.subject, prompt } })
        try { sessionStorage.setItem('wenxue-pending-turn:' + created.id, prompt) } catch {}
        location.hash = subjectLink(created.subject, created.id)
      }
    } catch (e) {
      setError(e.message)
    }
  }

  async function exportArchive() {
    setBusy(true)
    setError('')
    try {
      const payload = await api('/account/export')
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wenxue-learning-archive-${archive?.learner?.id || 'learner'}.json`
      a.click()
      URL.revokeObjectURL(url)
      setStatusMessage('已导出完整学习档案 JSON（含目标、任务、技能状态与原始证据）。')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteAllHistory() {
    setBusy(true)
    setError('')
    try {
      const res = await api('/account/history', { method: 'DELETE' })
      setConfirmDelete(false)
      setStatusMessage(`已清空本档案学习记录（移除 ${res.deletedConversations} 个会话与关联证据）。`)
      await load()
      await refresh?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!archive && !error) return <div className="loading">正在读取技能证据档案…</div>

  const defById = Object.fromEntries((archive?.definitions || []).map((d) => [d.id, d]))
  const stateById = Object.fromEntries((archive?.states || []).map((s) => [s.skill_id, s]))
  const evidenceBySkill = {}
  for (const ev of archive?.evidence || []) {
    if (!evidenceBySkill[ev.skill_id]) evidenceBySkill[ev.skill_id] = []
    evidenceBySkill[ev.skill_id].push(ev)
  }
  const auditsBySkill = {}
  for (const au of archive?.audits || []) {
    if (!auditsBySkill[au.skill_id]) auditsBySkill[au.skill_id] = []
    auditsBySkill[au.skill_id].push(au)
  }

  const skillIds = new Set([...(archive?.states || []).map((s) => s.skill_id), ...(showUnobserved ? (archive?.definitions || []).map((d) => d.id) : [])])
  const pendingRecs = (archive?.recommendations || []).filter((r) => r.status === 'pending')
  const validatedCount = (archive?.states || []).filter((s) => s.level === 'validated').length
  const reviewCount = (archive?.states || []).filter((s) => s.level === 'review_needed').length

  return <div className="progress-archive">
    <div className="archive-head">
      <div>
        <span className="hybrid-badge"><ShieldCheck size={13} />不可变学习证据与能力状态档案</span>
        <h1>{archive?.learner?.name || '当前学生'}的学习档案</h1>
        <p>能力状态严格由证据投影得出，不采用无依据的百分比打分；每条判断都可回溯至具体事实与校验器版本。</p>
      </div>
      <div className="archive-privacy-actions">
        <button type="button" className="button secondary compact" disabled={busy} onClick={exportArchive}><Download size={15} />导出 JSON</button>
        {!confirmDelete
          ? <button type="button" className="button secondary compact danger-outline" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} />清空学习记录</button>
          : <div className="confirm-delete-box">
              <span>确定永久删除当前孩子的所有会话、目标与证据？</span>
              <button type="button" className="button primary compact" disabled={busy} onClick={deleteAllHistory}>确认清空</button>
              <button type="button" className="button secondary compact" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button>
            </div>}
      </div>
    </div>

    <Notice text={error} />
    {statusMessage && <div className="lesson-feedback neutral" role="status"><CheckCircle2 size={18} /><div><p>{statusMessage}</p></div></div>}

    <div className="archive-kpi-row">
      <div><strong>{(archive?.states || []).length}</strong><span>已记录技能</span></div>
      <div><strong>{validatedCount}</strong><span>已迁移验证</span></div>
      <div><strong>{reviewCount}</strong><span>建议巩固</span></div>
      <div><strong>{(archive?.evidence || []).length}</strong><span>不可变证据条数</span></div>
    </div>

    {pendingRecs.length > 0 && <section className="archive-recs">
      <h2><Sparkles size={16} />待处理的个性化复习/衔接建议</h2>
      <div className="rec-list">
        {pendingRecs.map((rec) => <div className="rec-card" key={rec.id}>
          <div>
            <strong>{defById[rec.skill_id]?.title || rec.skill_id || '巩固练习'}</strong>
            <p>{rec.reason_text}</p>
          </div>
          <div className="rec-actions">
            <button type="button" className="button primary compact" onClick={() => updateRecommendation(rec, 'accepted')}>接受并开始</button>
            <button type="button" className="button secondary compact" onClick={() => updateRecommendation(rec, 'dismissed')}>暂不处理</button>
          </div>
        </div>)}
      </div>
    </section>}

    <section className="archive-skills-section">
      <div className="section-toolbar">
        <h2>技能状态与可追溯证据链</h2>
        <label className="toggle-unobserved"><input type="checkbox" checked={showUnobserved} onChange={(e) => setShowUnobserved(e.target.checked)} />显示尚未接触的目录技能</label>
      </div>

      {skillIds.size === 0 ? <div className="panel empty-panel">尚无学习证据记录。去学科教室完成一次探究或答题后，这里会自动沉淀证据。</div> : <div className="skill-archive-list">
        {[...skillIds].map((skillId) => {
          const def = defById[skillId] || { id: skillId, title: skillId, subject: skillId.split('.')[0], scope: '' }
          const st = stateById[skillId]
          const badge = stateMap[st?.level || 'unobserved'] || stateMap.unobserved
          const evList = evidenceBySkill[skillId] || []
          const auList = auditsBySkill[skillId] || []
          const misconceptions = Array.isArray(st?.pending_misconceptions) ? st.pending_misconceptions : []

          return <article className="skill-archive-card" key={skillId}>
            <div className="skill-archive-top">
              <div>
                <span className="skill-id-label">{def.id}</span>
                <h3>{def.title}</h3>
                {def.scope && <p className="muted">{def.scope}</p>}
              </div>
              <div className="skill-state-meta">
                <span className={'skill-state-pill ' + badge.cls}>{badge.text}</span>
                {st && <small>证据可信度：{formatConfidence(st.confidence)}</small>}
                {st?.last_verified_at && <small><Clock size={12} />最近核验：{new Date(st.last_verified_at).toLocaleString()}</small>}
              </div>
            </div>

            {misconceptions.length > 0 && <div className="misconception-pills">
              <AlertTriangle size={14} /><span>待澄清易错点：{misconceptions.join('、')}</span>
            </div>}

            <details className="evidence-details" open={evList.length > 0 && evList.length <= 4}>
              <summary><FileText size={14} />查看证据与状态审计（{evList.length} 条证据，{auList.length} 条状态变更）</summary>
              {evList.length > 0 && <ul className="evidence-timeline">
                {evList.map((ev) => <li key={ev.id} className={'ev-' + ev.verdict}>
                  <div className="ev-head">
                    <strong>{ev.fact}</strong>
                    <span className="ev-source">{sourceLabel[ev.evidence_source] || ev.evidence_source} · {ev.verdict}</span>
                  </div>
                  <div className="ev-meta">
                    <span>规则 {ev.rule_version || 'n/a'}</span>
                    <span>模型 {ev.model_version || 'n/a'}</span>
                    <span>{new Date(ev.created_at).toLocaleString()}</span>
                  </div>
                </li>)}
              </ul>}
              {auList.length > 0 && <ul className="audit-log-list">
                {auList.map((au) => <li key={au.id} className={au.conflict_rejected ? 'audit-conflict' : ''}>
                  <span>{au.from_level} → {au.to_level}</span>
                  <span>{au.reason}</span>
                  {au.conflict_rejected && <span className="conflict-tag">已拦截模型越级升级声明</span>}
                </li>)}
              </ul>}
            </details>
          </article>
        })}
      </div>}
    </section>
  </div>
}
