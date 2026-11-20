// M04 Evidence Evaluator
// Converts deterministic tool checks and student explanations into immutable append-only LearningEvidence
// and records append-only InteractionEvents. Never fabricates mastery or overwrites historical facts.

import { randomUUID } from 'node:crypto'
import { getAdapter } from './adapters/index.js'

export async function appendInteractionEvent(tx, { conversationId, learnerId, instanceId = null, actor = 'learner', eventType, payload = {}, idempotencyKey }) {
  const key = idempotencyKey || randomUUID()
  const existing = (await tx.query('SELECT * FROM interaction_events WHERE conversation_id = $1 AND idempotency_key = $2', [conversationId, key])).rows[0]
  if (existing) return { event: existing, duplicate: true }
  const id = randomUUID()
  const row = (await tx.query(
    'INSERT INTO interaction_events (id, conversation_id, learner_id, instance_id, actor, event_type, payload, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *',
    [id, conversationId, learnerId, instanceId, actor, eventType, JSON.stringify(payload), key],
  )).rows[0]
  return { event: row, duplicate: false }
}

export async function recordLearningEvidence(tx, {
  learnerId, subject, conversationId, turnId = null, eventId = null,
  skillId, fact, inference = '', verdict, confidence = 0.5,
  ruleVersion = 'none', modelVersion = 'none', evidenceSource, submissionKey, assessment = null,
}) {
  if (submissionKey) {
    const existing = (await tx.query('SELECT * FROM learning_evidence WHERE conversation_id = $1 AND submission_key = $2', [conversationId, submissionKey])).rows[0]
    if (existing) return { evidence: existing, duplicate: true }
  }
  const id = randomUUID()
  const row = (await tx.query(
    'INSERT INTO learning_evidence (id, learner_id, subject, conversation_id, turn_id, event_id, skill_id, fact, inference, verdict, confidence, rule_version, model_version, evidence_source, submission_key, assessment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING *',
    [id, learnerId, subject, conversationId, turnId, eventId, skillId, fact, inference, verdict, confidence, ruleVersion, modelVersion, evidenceSource, submissionKey || null, assessment ? JSON.stringify(assessment) : null],
  )).rows[0]
  return { evidence: row, duplicate: false }
}

export async function evaluateAndRecordAnswer(tx, {
  learnerId, subject, conversationId, eventId, question, value, answerText, explanation = '', unsure = false, defaultSkillId, submissionKey,
}) {
  const adapter = getAdapter(subject)
  const evalResult = adapter.evaluateAnswer({
    question: { ...question, isUnknown: question.isUnknown },
    value,
    answerText,
    explanation,
  })
  const skillId = defaultSkillId
  const misconception = skillId === evalResult.skillId ? evalResult.misconception : null
  const verdict = unsure && evalResult.verdict === 'correct' ? 'partial' : evalResult.verdict
  const confidence = evalResult.evidenceSource === 'rule_engine' ? (verdict === 'correct' ? 0.85 : 0.9) : 0.45
  const inference = unsure
    ? '学生自述不太确定，需通过追问或新情境验证真实理解。'
    : (misconception ? `候选误区：${misconception}` : '')

  const { evidence, duplicate } = await recordLearningEvidence(tx, {
    learnerId,
    subject,
    conversationId,
    eventId,
    skillId: skillId || `${subject}.general`,
    fact: evalResult.fact,
    inference,
    verdict,
    confidence,
    ruleVersion: evalResult.ruleVersion,
    modelVersion: 'none',
    evidenceSource: evalResult.evidenceSource,
    submissionKey,
    assessment: { questionId: question.id, answerExcerpt: answerText, outcome: evalResult.verdict, ...(unsure ? { unsure: true } : {}), ...(question.evidenceProbe ? { focus: question.focus || 'reasoning' } : {}), ...(question.transferFrom ? { transferFrom: question.transferFrom } : {}), attempt: question.tries },
  })

  return {
    evidence,
    duplicate,
    evalResult: { ...evalResult, skillId, verdict, misconception },
    adapterSupportsDeterministic: adapter.supportsDeterministicCheck,
  }
}

function checkWrittenValue(question, answer) {
  const normalize = (text) => text.normalize('NFKC').trim().toLowerCase()
  const normalizedAnswer = normalize(answer)
  let objectiveOutcome = null
  if (question.type === 'choice') {
    const letter = /^(?:我选(?:择)?\s*|选(?:择)?\s*)?([a-f])(?:$|[.、,，。!！:：)\s])/i.exec(normalizedAnswer)?.[1]
    const matching = question.options.flatMap((option, index) => {
      const clean = normalize(option)
      return normalizedAnswer === clean || (clean && normalizedAnswer.startsWith(clean) && /^[、,，。.!！;；\s]/.test(normalizedAnswer.slice(clean.length))) ? [index] : []
    })
    const labelIndex = letter === undefined ? null : letter.charCodeAt(0) - 97
    const value = labelIndex !== null && labelIndex < question.options.length ? labelIndex : matching.length === 1 ? matching[0] : null
    if (value !== null) objectiveOutcome = (question.neutralOptions || []).includes(value) ? 'uncertain' : value === question.answer ? 'correct' : 'incorrect'
  } else if (question.type === 'number' && /^[-+]?\d+(\.\d+)?$/.test(normalizedAnswer)) {
    objectiveOutcome = Math.abs(Number(normalizedAnswer) - question.answer) <= (question.tolerance ?? 0) ? 'correct' : 'incorrect'
  }
  return objectiveOutcome
}

export function evaluateTextAnswer(question, assessment, studentText, { reasoningOnly = false } = {}) {
  if (!question || typeof studentText !== 'string' || !studentText.trim()) return null
  const original = studentText.trim()
  const excerpt = typeof assessment?.reasoningExcerpt === 'string' && assessment.reasoningExcerpt.trim()
  const modelAnswer = typeof assessment?.answerExcerpt === 'string' && assessment.answerExcerpt.trim()
  const validAssessment = assessment?.questionId === question.id && modelAnswer && modelAnswer.length <= 1000 &&
    original.includes(modelAnswer) && ['correct', 'incorrect', 'uncertain'].includes(assessment.outcome)
  const exact = original.replace(/[。.!！]+$/, '')
  const namedChoice = question.type === 'choice' && exact.match(/^我(?:先)?选(?:择)?\s*[A-FＡ-Ｆ](?=[:：、，。,.\s]|$)/i)?.[0]
  const directOutcome = /^[a-f]$/i.test(exact) || question.options?.some((option) => option.toLowerCase() === exact.toLowerCase()) || question.type === 'number'
    ? checkWrittenValue(question, exact)
    : namedChoice ? checkWrittenValue(question, namedChoice) : null
  if (!validAssessment && !directOutcome) return null
  const answer = directOutcome ? (namedChoice || exact) : modelAnswer
  const objectiveOutcome = directOutcome || checkWrittenValue(question, answer)
  const outcome = objectiveOutcome || assessment.outcome
  const unsure = /猜的|蒙的|不太确定|不确定为什么/.test(original)
  const reasoningExcerpt = validAssessment && !unsure && outcome === 'correct' && assessment.outcome === 'correct' && excerpt &&
    (excerpt !== answer || (reasoningOnly && excerpt.length >= 4)) && excerpt.length <= 1000 && original.includes(excerpt) ? excerpt : null
  return { questionId: question.id, answerExcerpt: answer, outcome, objective: Boolean(objectiveOutcome), unsure, reasoningExcerpt, attempt: (question.tries || 0) + 1 }
}

export async function evaluateAndRecordExploration(tx, {
  learnerId, subject, conversationId, eventId, config, snapshot, explanation = '', defaultSkillId, submissionKey,
}) {
  const adapter = getAdapter(subject)
  const evalResult = adapter.evaluateExploration({ config, snapshot, explanation })
  const skillId = evalResult.skillId && !evalResult.skillId.endsWith('.general') ? evalResult.skillId : (defaultSkillId || evalResult.skillId)
  const confidence = evalResult.evidenceSource === 'rule_engine' ? 0.9 : 0.4
  const inference = evalResult.misconception
    ? `检测到可能误区：${evalResult.misconception}`
    : (explanation ? `学生观察自述：${explanation.slice(0, 160)}` : '完成参数探索并提交核对。')

  const { evidence, duplicate } = await recordLearningEvidence(tx, {
    learnerId,
    subject,
    conversationId,
    eventId,
    skillId,
    fact: evalResult.fact,
    inference,
    verdict: evalResult.verdict,
    confidence,
    ruleVersion: evalResult.ruleVersion,
    modelVersion: 'none',
    evidenceSource: evalResult.evidenceSource,
    submissionKey,
  })

  return {
    evidence,
    duplicate,
    evalResult: { ...evalResult, skillId },
    adapterSupportsDeterministic: adapter.supportsDeterministicCheck,
  }
}
