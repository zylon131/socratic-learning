import React, { useEffect, useState } from 'react'
import { ArrowRight, BookOpen, Cpu, GitBranch, Search } from 'lucide-react'
import { Notice, SubjectIcon, subjectLink, useLearnerApi } from './ui.jsx'

const levelLabels = {
  unobserved: { text: '未学习', cls: 'state-unobserved' },
  emerging: { text: '待验证', cls: 'state-emerging' },
  understood: { text: '已理解', cls: 'state-understood' },
  validated: { text: '已迁移验证', cls: 'state-validated' },
  review_needed: { text: '建议巩固', cls: 'state-review' },
}

export function CatalogView({ data }) {
  const api = useLearnerApi()
  const [catalog, setCatalog] = useState(null)
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [limits, setLimits] = useState({})
  const [startingSkill, setStartingSkill] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api('/catalog')
      .then((res) => { if (!cancelled) setCatalog(res) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [data?.learner?.id])

  async function startSkillStudy(skill) {
    if (startingSkill) return
    setStartingSkill(skill.id)
    setError('')
    try {
      const prompt = `我想系统学习「${skill.title}」：${skill.scope}`
      const created = await api('/study/start', { body: { subject: skill.subject, skillId: skill.id, prompt } })
      try { sessionStorage.setItem('wenxue-pending-turn:' + created.id, prompt) } catch {}
      location.hash = subjectLink(created.subject, created.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setStartingSkill('')
    }
  }

  if (!catalog && !error) return <div className="loading">正在加载课程技能目录…</div>

  const stateBySkill = Object.fromEntries((catalog?.states || []).map((s) => [s.skill_id, s]))
  const skillById = Object.fromEntries((catalog?.skills || []).map((s) => [s.id, s]))
  const adapterBySubject = Object.fromEntries((catalog?.adapters || []).map((a) => [a.subjectId, a]))
  const prereqsByTarget = {}
  for (const rel of catalog?.prerequisites || []) {
    if (!prereqsByTarget[rel.to_skill]) prereqsByTarget[rel.to_skill] = []
    prereqsByTarget[rel.to_skill].push(skillById[rel.from_skill]?.title || rel.from_skill)
  }

  const subjects = catalog?.subjects || data?.subjects || []
  const q = query.trim().toLowerCase()
  const visibleSubjects = subjects.filter((subj) => {
    if (subjectFilter !== 'all' && subj.id !== subjectFilter) return false
    return (catalog?.skills || []).some((sk) => sk.subject === subj.id && (!q || sk.title.toLowerCase().includes(q) || sk.scope.toLowerCase().includes(q)))
  })

  return <div className="catalog-view">
    <div className="catalog-header">
      <div>
        <span className="hybrid-badge"><BookOpen size={13} />结构化课程目录 · 技能图谱</span>
        <h1>精选专题与前置知识依赖</h1>
        <p>选择一个知识点开始学习。老师会结合相关先修知识和你的回答，安排下一步。</p>
      </div>
      <div className="catalog-controls">
        <label className="catalog-search">
          <Search size={15} />
          <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimits({}) }} placeholder="搜索知识点…" aria-label="搜索知识点" />
        </label>
        <div className="catalog-filter-pills" role="group" aria-label="按学科筛选">
          <button type="button" className={subjectFilter === 'all' ? 'active' : ''} onClick={() => setSubjectFilter('all')}>全部学科</button>
          {subjects.filter((s) => (catalog?.skills || []).some((k) => k.subject === s.id)).map((s) => (
            <button key={s.id} type="button" className={subjectFilter === s.id ? 'active' : ''} onClick={() => setSubjectFilter(s.id)}>{s.name}</button>
          ))}
        </div>
      </div>
    </div>
    <Notice text={error} />
    {catalog?.taxonomyAttribution && <p className="muted">知识图谱来自 <a href={catalog.taxonomyAttribution.repository}>{catalog.taxonomyAttribution.name}</a>（{catalog.taxonomyAttribution.author}），采用 <a href={catalog.taxonomyAttribution.licenseUrl}>{catalog.taxonomyAttribution.license}</a> 许可。知识点及先修关系为待教师核对的课程参考。</p>}

    {visibleSubjects.map((subj) => {
      const adapter = adapterBySubject[subj.id]
      const list = (catalog?.skills || []).filter((sk) => sk.subject === subj.id && (!q || sk.title.toLowerCase().includes(q) || sk.scope.toLowerCase().includes(q)))
      const limit = limits[subj.id] || 12
      return <section className="catalog-subject-section" key={subj.id}>
        <header className="catalog-subject-head">
          <div className="catalog-subject-title">
            <SubjectIcon subject={subj} />
            <h2>{subj.name}</h2>
          </div>
          <span className={'adapter-badge ' + (adapter?.supportsDeterministicCheck ? 'deterministic' : 'semantic')}>
            <Cpu size={13} />
            {adapter?.supportsDeterministicCheck ? `确定性规则校验 (${adapter.ruleVersion})` : '通用语义分步辅导'}
          </span>
        </header>
        <div className="catalog-grid">
          {list.slice(0, limit).map((skill) => {
            const st = stateBySkill[skill.id]
            const badge = levelLabels[st?.level || 'unobserved'] || levelLabels.unobserved
            const prereqs = prereqsByTarget[skill.id] || []
            return <article className="skill-card" key={skill.id}>
              <div className="skill-card-top">
                <span className={'skill-state-pill ' + badge.cls}>{badge.text}</span>
                <span className="skill-source-tag">{skill.source_type === 'cn-math-taxonomy' ? '知识图谱参考' : skill.source_type === 'curated' ? '精选课程' : 'AI 延伸'}</span>
                {skill.criteria?.chapter && <span className="skill-source-tag">{skill.criteria.chapter}</span>}
              </div>
              <h3>{skill.title}</h3>
              <p>{skill.scope}</p>
              {prereqs.length > 0 && <div className="skill-prereqs"><GitBranch size={13} /><span>先修：{prereqs.join('、')}</span></div>}
              <div className="skill-card-footer">
                <code>{skill.id}</code>
                <button type="button" className="button primary compact" disabled={startingSkill === skill.id} onClick={() => startSkillStudy(skill)}>
                  {startingSkill === skill.id ? '进入中…' : '进入学习'}<ArrowRight size={14} />
                </button>
              </div>
            </article>
          })}
        </div>
        {list.length > limit && <button type="button" className="text-button" onClick={() => setLimits((current) => ({ ...current, [subj.id]: limit + 12 }))}>查看更多{ subj.name }知识点（还有 {list.length - limit} 项）</button>}
      </section>
    })}

    {visibleSubjects.length === 0 && !error && <div className="panel empty-panel">没有匹配「{query}」的课程技能，你可以直接去首页自由输入想学的内容。</div>}
  </div>
}
