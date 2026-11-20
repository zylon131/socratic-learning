// M11 Observability, Security Audit, Privacy Export/Delete, and Anonymized Quality Metrics + EVAL Suite

import { randomUUID } from 'node:crypto'
import { chemistryAdapter } from './adapters/chemistry.js'
import { mathAdapter } from './adapters/math.js'
import { computeSkillProjection } from './skills.js'
import { detectTaskCycle } from './tasks.js'

export function redactText(text = '') {
  return String(text)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(sk-|key-|token_)[A-Za-z0-9_-]{8,}/gi, '[secret]')
    .slice(0, 240)
}

export async function recordAgentRun(db, {
  requestId = null,
  turnId = null,
  conversationId = null,
  learnerId = null,
  promptVersion,
  skillVersions = {},
  modelId = 'deepseek-flash',
  toolCalls = [],
  validationResult = 'ok',
  durationMs = 0,
  status = 'completed',
  errorCode = '',
  redactedSummary = '',
}) {
  try {
    await db.query(
      'INSERT INTO agent_runs (id, request_id, turn_id, conversation_id, learner_id, prompt_version, skill_versions, model_id, tool_calls, validation_result, duration_ms, status, error_code, redacted_summary) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,$12,$13,$14)',
      [randomUUID(), requestId, turnId, conversationId, learnerId, promptVersion, JSON.stringify(skillVersions), modelId, JSON.stringify(toolCalls), validationResult, Math.max(0, Math.round(durationMs)), status, errorCode, redactText(redactedSummary)],
    )
  } catch (err) {
    console.error('Failed to record agent run:', err.message)
  }
}

export async function logSecurityAudit(db, { actorAccountId = null, targetResource, action, outcome, reason = '' }) {
  try {
    await db.query(
      'INSERT INTO security_audit_logs (id, actor_account_id, target_resource, action, outcome, reason) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actorAccountId, String(targetResource).slice(0, 120), action, outcome, String(reason).slice(0, 200)],
    )
  } catch (err) {
    console.error('Failed to record security audit:', err.message)
  }
}

/**
 * Strictly anonymized aggregate metrics for Admin/Quality dashboard (AC-32).
 * Never exposes private learner messages, answers, or emails.
 */
export async function getAnonymizedQualityMetrics(db) {
  const { rows: runs } = await db.query(
    'SELECT prompt_version, model_id, validation_result, status, duration_ms, error_code, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 500',
  )
  const totalRuns = runs.length
  const failedRuns = runs.filter((r) => r.status !== 'completed').length
  const validationFailures = runs.filter((r) => r.validation_result !== 'ok').length
  const durations = runs.map((r) => Number(r.duration_ms || 0)).filter((n) => n >= 0).sort((a, b) => a - b)
  const pct = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : 0)

  const byVersion = {}
  for (const r of runs) {
    const k = `${r.prompt_version}|${r.model_id}`
    if (!byVersion[k]) byVersion[k] = { promptVersion: r.prompt_version, modelId: r.model_id, total: 0, completed: 0, failed: 0, validationFailures: 0 }
    byVersion[k].total++
    if (r.status === 'completed') byVersion[k].completed++
    else byVersion[k].failed++
    if (r.validation_result !== 'ok') byVersion[k].validationFailures++
  }

  const { rows: auditSummary } = await db.query(
    'SELECT count(*)::int AS total, count(*) FILTER (WHERE conflict_rejected)::int AS conflicts_rejected FROM skill_state_audit',
  )
  const { rows: securitySummary } = await db.query(
    "SELECT count(*)::int AS denied_access_count FROM security_audit_logs WHERE outcome = 'denied'",
  )

  return {
    privacyPolicy: 'strictly_anonymized_aggregates_only',
    summary: {
      totalRuns,
      completedRuns: totalRuns - failedRuns,
      failedRuns,
      validationFailures,
      latencyP50Ms: pct(0.5),
      latencyP95Ms: pct(0.95),
      stateTransitions: auditSummary[0]?.total || 0,
      conflictsRejected: auditSummary[0]?.conflicts_rejected || 0,
      deniedAccessAudits: securitySummary[0]?.denied_access_count || 0,
    },
    versionComparison: Object.values(byVersion),
  }
}

export async function exportLearnerHistory(db, learnerId) {
  const { rows: goals } = await db.query('SELECT * FROM learning_goals WHERE learner_id = $1 ORDER BY created_at DESC', [learnerId])
  const { rows: tasks } = await db.query('SELECT * FROM learning_tasks WHERE learner_id = $1 ORDER BY created_at DESC', [learnerId])
  const { rows: skillStates } = await db.query('SELECT * FROM skill_states WHERE learner_id = $1 ORDER BY updated_at DESC', [learnerId])
  const { rows: evidence } = await db.query('SELECT * FROM learning_evidence WHERE learner_id = $1 ORDER BY created_at DESC', [learnerId])
  const { rows: conversations } = await db.query('SELECT id, subject, title, updated_at FROM conversations WHERE learner_id = $1 ORDER BY updated_at DESC', [learnerId])
  return {
    exportedAt: new Date().toISOString(),
    learnerId,
    goals,
    tasks,
    skillStates,
    evidence,
    conversations,
  }
}

export async function deleteLearnerHistory(db, learnerId) {
  return db.transaction(async (tx) => {
    await tx.query(
      'UPDATE credit_entries SET turn_id = NULL WHERE turn_id IN (SELECT t.id FROM turns t JOIN conversations c ON c.id = t.conversation_id WHERE c.learner_id = $1)',
      [learnerId],
    )
    const convRes = await tx.query('DELETE FROM conversations WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM learning_goals WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM learning_tasks WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM interaction_instances WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM interaction_events WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM learning_evidence WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM skill_states WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM skill_state_audit WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM learning_recommendations WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM learner_subjects WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM attempts WHERE learner_id = $1', [learnerId])
    return { deletedConversations: convRes.rowCount || 0, deletedAt: new Date().toISOString() }
  })
}

export function runEvalBenchmarkSuite({ normalizeProposal }) {
  const results = []
  const runCase = (id, title, fn) => {
    try {
      const detail = fn()
      results.push({ id, title, passed: true, detail })
    } catch (err) {
      results.push({ id, title, passed: false, detail: err.message })
    }
  }

  runCase('EVAL-01', '化学规则校验：H₂+O₂→2H₂O 不得判为已配平 (AC-13)', () => {
    const res = chemistryAdapter.evaluateExploration({
      config: { reactants: [{ formula: 'H2', coeff: 1, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }], products: [{ formula: 'H2O', coeff: 1, atoms: { H: 2, O: 1 } }] },
      snapshot: { leftCoeffs: [1, 1], rightCoeffs: [2] },
    })
    if (res.balanced) throw new Error('错误将 H2+O2->2H2O 判为已配平')
    return res.fact
  })

  runCase('EVAL-02', '化学规则校验：2H₂+O₂→2H₂O 为最简守恒配平', () => {
    const res = chemistryAdapter.evaluateExploration({
      config: { reactants: [{ formula: 'H2', coeff: 1, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }], products: [{ formula: 'H2O', coeff: 1, atoms: { H: 2, O: 1 } }] },
      snapshot: { leftCoeffs: [2, 1], rightCoeffs: [2] },
    })
    if (!res.balanced || !res.simplest || res.verdict !== 'correct') throw new Error('未能正确通过 2H2+O2->2H2O 校验')
    return res.fact
  })

  runCase('EVAL-03', '化学防篡改：修改化学式下标 H₂O₂ 替代配平被阻断', () => {
    const c = chemistryAdapter.checkConservation(
      [{ formula: 'H2', coeff: 1, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }],
      [{ formula: 'H2O2', coeff: 1, atoms: { H: 2, O: 2 } }],
      { reactants: [{ formula: 'H2' }, { formula: 'O2' }], products: [{ formula: 'H2O' }] },
    )
    if (!c.subscriptTampered) throw new Error('未能检测到篡改化学式下标')
    return '成功拦截下标改写'
  })

  runCase('EVAL-04', '状态保护：单次答对不得直接升级为 validated (AC-14/AC-16)', () => {
    const proj = computeSkillProjection([{ id: 'e1', verdict: 'correct', evidence_source: 'rule_engine', fact: '选对一道单选题', inference: '' }])
    if (proj.level === 'validated' || proj.level === 'understood') throw new Error('单次选择正确违规升级为 ' + proj.level)
    return `投影状态为 ${proj.level}`
  })

  runCase('EVAL-05', '图解算子校验：自动覆盖模型编造的错误原子数 (M08)', () => {
    const prop = normalizeProposal({
      version: '1.0',
      topic: '化学配平',
      blocks: [{ type: 'explorer', component: 'equation', title: '测试', reactants: [{ formula: 'H2O', coeff: 2, atoms: { H: 99, O: 99 } }], products: [{ formula: 'H2', coeff: 2, atoms: { H: 2 } }, { formula: 'O2', coeff: 1, atoms: { O: 2 } }] }],
    })
    const eq = prop.frame.presentation[0].props
    if (eq.reactants[0].atoms.H !== 2 || eq.reactants[0].atoms.O !== 1) throw new Error('未用化学解析器纠正模型原子计数')
    return '已用确定性化学解析器修正原子计数 H=2, O=1'
  })

  runCase('EVAL-06', '安全防护：恶意 HTML/Script 组件配置被拒绝 (AC-23)', () => {
    let blocked = false
    try {
      normalizeProposal({
        version: '1.0',
        topic: 'XSS Test',
        blocks: [{ type: 'text', text: '<script>alert(1)</script>危险内容' }],
      })
    } catch {
      blocked = true
    }
    if (!blocked) throw new Error('未拦截包含 <script> 的组件配置')
    return '成功拦截脚本注入载荷'
  })

  runCase('EVAL-07', '先修循环防护：阻止 A→B→A 无限补习环 (AC-19)', () => {
    const tasks = [
      { id: 't1', goal_id: 'g1', parent_task_id: null, skill_id: 'chem.equation_balancing', status: 'paused' },
      { id: 't2', goal_id: 'g1', parent_task_id: 't1', skill_id: 'chem.coefficient_meaning', status: 'active' },
    ]
    const check = detectTaskCycle(tasks, tasks[1], 'chem.equation_balancing', 'loop')
    if (!check.cycleDetected) throw new Error('未拦截 A→B→A 循环依赖')
    return check.reason
  })

  runCase('EVAL-08', '第二学科适配器：数学一次方程确定性校验 (AC-28)', () => {
    const ok = mathAdapter.verifyLinearSolution('2x+3=11', 4)
    const bad = mathAdapter.verifyLinearSolution('2x+3=11', 5)
    if (!ok.balanced || bad.balanced) throw new Error('数学方程确定性校验异常')
    return '2x+3=11 代入 x=4 平衡成立，x=5 不成立'
  })

  return { ranAt: new Date().toISOString(), total: results.length, passed: results.filter((r) => r.passed).length, results }
}
