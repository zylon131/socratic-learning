import React, { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Play, ShieldAlert, XCircle } from 'lucide-react'
import { Notice, useLearnerApi } from './ui.jsx'

export function QualityView() {
  const api = useLearnerApi()
  const [metrics, setMetrics] = useState(null)
  const [evalReport, setEvalReport] = useState(null)
  const [runningEval, setRunningEval] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/quality/metrics')
      .then(setMetrics)
      .catch((e) => setError(e.message))
  }, [])

  async function runEval() {
    if (runningEval) return
    setRunningEval(true)
    setError('')
    try {
      const report = await api('/quality/eval', { body: {} })
      setEvalReport(report)
    } catch (e) {
      setError(e.message)
    } finally {
      setRunningEval(false)
    }
  }

  if (!metrics && !error) return <div className="loading">正在读取去标识化系统质量指标…</div>
  const s = metrics?.summary || {}

  return <div className="quality-dashboard">
    <div className="archive-head">
      <div>
        <span className="hybrid-badge"><Activity size={13} />系统质量与确定性评测面板</span>
        <h1>运行可观测性与 EVAL 基线</h1>
        <p>严格脱敏隐私边界（{metrics?.privacyPolicy || 'strictly_anonymized_aggregates_only'}）：仅统计状态、耗时与版本聚合指标，不读取学生聊天正文。</p>
      </div>
      <button type="button" className="button primary" disabled={runningEval} onClick={runEval}>
        <Play size={16} />{runningEval ? '评测执行中…' : '运行 EVAL 评测集'}
      </button>
    </div>

    <Notice text={error} />

    <div className="archive-kpi-row quality-kpis">
      <div><strong>{s.totalRuns ?? 0}</strong><span>Agent 运行轮次</span></div>
      <div><strong>{s.completedRuns ?? 0}</strong><span>成功完成</span></div>
      <div><strong>{s.validationFailures ?? 0}</strong><span>契约/校验拦截</span></div>
      <div><strong>{s.latencyP50Ms ?? 0} / {s.latencyP95Ms ?? 0} ms</strong><span>P50 / P95 耗时</span></div>
      <div><strong>{s.conflictsRejected ?? 0}</strong><span>越级声明拦截</span></div>
      <div><strong>{s.deniedAccessAudits ?? 0}</strong><span>越权访问拦截</span></div>
    </div>

    <section className="panel quality-panel">
      <h2>版本与模型对比（Prompt / Model）</h2>
      {metrics?.versionComparison?.length ? <table className="eval-table">
        <thead><tr><th>Prompt 版本</th><th>模型</th><th>总轮次</th><th>成功</th><th>失败</th><th>校验失败</th></tr></thead>
        <tbody>{metrics.versionComparison.map((row) => <tr key={`${row.promptVersion}-${row.modelId}`}>
          <td><code>{row.promptVersion}</code></td>
          <td><code>{row.modelId}</code></td>
          <td>{row.total}</td>
          <td>{row.completed}</td>
          <td>{row.failed}</td>
          <td>{row.validationFailures}</td>
        </tr>)}</tbody>
      </table> : <p className="muted">尚无 Agent 运行记录，完成一次教学回合后自动记录脱敏观测指标。</p>}
    </section>

    <section className="panel quality-panel">
      <div className="section-toolbar">
        <h2>回归评测基准（EVAL-01 ~ EVAL-08）</h2>
        {evalReport && <span className="eval-score-pill">{evalReport.passed} / {evalReport.total} 通过 · {new Date(evalReport.ranAt).toLocaleTimeString()}</span>}
      </div>
      {evalReport ? <table className="eval-table">
        <thead><tr><th>用例</th><th>验收规则</th><th>状态</th><th>详情</th></tr></thead>
        <tbody>{evalReport.results.map((r) => <tr key={r.id}>
          <td><code>{r.id}</code></td>
          <td>{r.title}</td>
          <td>{r.passed ? <span className="eval-pass"><CheckCircle2 size={15} />通过</span> : <span className="eval-fail"><XCircle size={15} />失败</span>}</td>
          <td>{r.detail}</td>
        </tr>)}</tbody>
      </table> : <p className="muted"><ShieldAlert size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />点击右上角「运行 EVAL 评测集」即时校验化学配平防错、状态投影冲突拒绝、XSS 阻断、A→B→A 环路防护及数学适配器。</p>}
    </section>
  </div>
}
