// M05 Skill State Manager
// Maintains verifiable, rebuildable per-skill projections from append-only LearningEvidence.
// Enforces hard invariants: single choice != validated mastery, error does not wipe unrelated skills,
// and LLM cannot directly promote a skill when deterministic evidence conflicts.

import { randomUUID } from 'node:crypto'

export const SKILL_LEVELS = ['unobserved', 'emerging', 'understood', 'validated', 'review_needed']

/**
 * Pure projection from append-only evidence rows (ordered oldest -> newest).
 */
export function computeSkillProjection(evidenceRows) {
  const active = (evidenceRows || []).filter((e) => !e.superseded_by)
  if (!active.length) {
    return {
      level: 'unobserved',
      confidence: 0,
      lastVerifiedAt: null,
      evidenceRefs: [],
      pendingMisconceptions: [],
    }
  }

  const evidenceRefs = active.slice(-12).map((e) => e.id)
  const latest = active[active.length - 1]
  const correctRuleRows = active.filter((e) => e.verdict === 'correct' && e.evidence_source === 'rule_engine')
  const reasoningRows = active.filter((e) =>
    e.verdict === 'correct' && (e.assessment
      ? Boolean(e.assessment.reasoningExcerpt)
      : e.evidence_source === 'llm_semantic' || /解释|理由|守恒|transfer|独立迁移/.test(e.fact + ' ' + e.inference)),
  )
  const transferRows = active.filter((e) => !e.assessment && e.verdict === 'correct' && /迁移|新情境|独立配平|transfer/.test(e.fact + ' ' + e.inference))
  const misconceptions = active
    .filter((e) => e.verdict === 'incorrect' && e.inference)
    .slice(-3)
    .map((e) => e.inference)

  // Latest authoritative incorrect or regression -> review_needed for THIS skill only (AC-15)
  if (latest.verdict === 'incorrect') {
    return {
      level: 'review_needed',
      confidence: 0.35,
      lastVerifiedAt: latest.created_at || new Date().toISOString(),
      evidenceRefs,
      pendingMisconceptions: misconceptions,
    }
  }

  let level = 'emerging'
  let confidence = 0.45

  // Generic un-adapted subjects without deterministic rule engine cannot claim validated mastery (AC-27)
  const hasRuleEngineBacking = correctRuleRows.length > 0
  const hasExplained = reasoningRows.some((e) => e.assessment?.reasoningExcerpt)
  const legacyCorrect = correctRuleRows.filter((e) => !e.assessment).length
  if (hasRuleEngineBacking && reasoningRows.length >= 1 && transferRows.length >= 1) {
    level = 'validated'
    confidence = 0.92
  } else if (hasExplained || (hasRuleEngineBacking && (reasoningRows.length >= 1 || legacyCorrect >= 2)) || reasoningRows.length >= 2) {
    level = 'understood'
    confidence = hasRuleEngineBacking ? 0.78 : 0.65
  } else if (active.some((e) => ['correct', 'partial', 'observed'].includes(e.verdict))) {
    level = 'emerging'
    confidence = 0.45
  }

  return {
    level,
    confidence,
    lastVerifiedAt: latest.created_at || new Date().toISOString(),
    evidenceRefs,
    pendingMisconceptions: level === 'validated' ? [] : misconceptions,
  }
}

export async function applySkillStateUpdate(tx, {
  learnerId,
  skillId,
  evidenceId = null,
  proposedLevel = null,
  actor = 'state_manager',
  reason = '根据最新学习证据重新投影技能状态',
}) {
  if (!skillId) return null

  const existingState = (await tx.query('SELECT * FROM skill_states WHERE learner_id = $1 AND skill_id = $2', [learnerId, skillId])).rows[0]
  if (evidenceId && existingState && Array.isArray(existingState.evidence_refs) && existingState.evidence_refs.includes(evidenceId) && !proposedLevel) {
    return { state: existingState, conflictRejected: false, idempotent: true }
  }

  const { rows: evidenceRows } = await tx.query(
    'SELECT * FROM learning_evidence WHERE learner_id = $1 AND skill_id = $2 ORDER BY created_at ASC, id ASC',
    [learnerId, skillId],
  )
  const projection = computeSkillProjection(evidenceRows)
  const fromLevel = existingState?.level || 'unobserved'

  // Conflict check (AC-16): reject LLM claim that contradicts deterministic / evidence threshold
  let conflictRejected = false
  let auditReason = reason
  if (proposedLevel && SKILL_LEVELS.includes(proposedLevel)) {
    const rank = { unobserved: 0, review_needed: 1, emerging: 2, understood: 3, validated: 4 }
    if (rank[proposedLevel] > rank[projection.level]) {
      conflictRejected = true
      auditReason = `拒绝模型将技能直接升为 ${proposedLevel}：当前有效证据仅支持 ${projection.level}（需独立解释或新情境迁移验证）。`
    }
  }

  const stateRow = (await tx.query(
    'INSERT INTO skill_states (learner_id, skill_id, level, confidence, last_verified_at, evidence_refs, pending_misconceptions, revision, updated_at) ' +
    'VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,1,now()) ' +
    'ON CONFLICT (learner_id, skill_id) DO UPDATE SET level=excluded.level, confidence=excluded.confidence, last_verified_at=excluded.last_verified_at, evidence_refs=excluded.evidence_refs, pending_misconceptions=excluded.pending_misconceptions, revision=skill_states.revision+1, updated_at=now() RETURNING *',
    [learnerId, skillId, projection.level, projection.confidence, projection.lastVerifiedAt, JSON.stringify(projection.evidenceRefs), JSON.stringify(projection.pendingMisconceptions)],
  )).rows[0]

  if (fromLevel !== projection.level || conflictRejected) {
    await tx.query(
      'INSERT INTO skill_state_audit (id, learner_id, skill_id, from_level, to_level, reason, actor, evidence_id, conflict_rejected) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), learnerId, skillId, fromLevel, projection.level, auditReason, conflictRejected ? 'state_manager_guard' : actor, evidenceId, conflictRejected],
    )
  }

  return { state: stateRow, conflictRejected, fromLevel, toLevel: projection.level }
}

export async function rebuildSkillStatesForLearner(db, learnerId) {
  return db.transaction(async (tx) => {
    const { rows: skills } = await tx.query('SELECT DISTINCT skill_id FROM learning_evidence WHERE learner_id = $1', [learnerId])
    await tx.query('DELETE FROM skill_states WHERE learner_id = $1', [learnerId])
    const rebuilt = []
    for (const { skill_id: skillId } of skills) {
      const res = await applySkillStateUpdate(tx, { learnerId, skillId, actor: 'rebuild_projection', reason: '从不可变证据全量重建能力状态投影' })
      if (res?.state) rebuilt.push(res.state)
    }
    return rebuilt
  })
}

export async function getLearnerSkillArchive(db, learnerId) {
  const { rows: defs } = await db.query('SELECT * FROM skill_definitions ORDER BY subject, id')
  const { rows: states } = await db.query('SELECT * FROM skill_states WHERE learner_id = $1 ORDER BY updated_at DESC', [learnerId])
  const { rows: evidence } = await db.query('SELECT * FROM learning_evidence WHERE learner_id = $1 ORDER BY created_at DESC LIMIT 120', [learnerId])
  const { rows: audits } = await db.query('SELECT * FROM skill_state_audit WHERE learner_id = $1 ORDER BY created_at DESC LIMIT 60', [learnerId])
  const { rows: recommendations } = await db.query('SELECT * FROM learning_recommendations WHERE learner_id = $1 ORDER BY created_at DESC LIMIT 20', [learnerId])
  return { definitions: defs, states, evidence, audits, recommendations }
}
