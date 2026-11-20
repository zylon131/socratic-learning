// M06 Learning Goals, Task Tree, Prerequisite Dependencies, and TaskFrame Suspension/Resume
// Maintains persistent parent/child tasks with cycle detection, depth guards, and exact question/component restoration.

import { randomUUID } from 'node:crypto'

export const MAX_RECOMMENDED_REMEDIATION_DEPTH = 3

export async function ensureGoalAndRootTask(tx, { learnerId, subject, conversationId, title, skillId, source = 'free_input' }) {
  const existingTasks = (await tx.query('SELECT * FROM learning_tasks WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId])).rows
  if (existingTasks.length > 0) {
    const goal = existingTasks[0].goal_id
      ? (await tx.query('SELECT * FROM learning_goals WHERE id = $1', [existingTasks[0].goal_id])).rows[0]
      : null
    return { goal, tasks: existingTasks }
  }
  const goalId = randomUUID()
  const rootTaskId = randomUUID()
  const goal = (await tx.query(
    'INSERT INTO learning_goals (id, learner_id, subject, title, topic, source, status, root_task_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [goalId, learnerId, subject, title || `${subject}学习`, title || '', source, 'active', rootTaskId],
  )).rows[0]
  const rootTask = (await tx.query(
    'INSERT INTO learning_tasks (id, conversation_id, learner_id, goal_id, parent_task_id, skill_id, title, status, depth) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [rootTaskId, conversationId, learnerId, goalId, null, skillId || null, title || `${subject}学习`, 'active', 0],
  )).rows[0]
  return { goal, tasks: [rootTask] }
}

export async function getTaskTree(db, conversationId) {
  const { rows: tasks } = await db.query('SELECT * FROM learning_tasks WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC', [conversationId])
  if (!tasks.length) return { goal: null, tasks: [], activeTask: null, activePath: [], pausedTasks: [] }
  const goal = tasks[0].goal_id
    ? (await db.query('SELECT * FROM learning_goals WHERE id = $1', [tasks[0].goal_id])).rows[0]
    : null
  const activeTask = tasks.findLast((t) => t.status === 'active') || tasks[tasks.length - 1]
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const activePath = []
  let cursor = activeTask
  const seen = new Set()
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    activePath.unshift(cursor)
    cursor = cursor.parent_task_id ? byId.get(cursor.parent_task_id) : null
  }
  const pausedTasks = tasks.filter((t) => t.status === 'paused')
  return { goal, tasks, activeTask, activePath, pausedTasks }
}

export async function getPrerequisitesForSkill(db, skillId) {
  if (!skillId) return []
  const { rows } = await db.query(
    'SELECT p.*, d.title AS from_title, d.scope AS from_scope FROM prerequisite_relations p JOIN skill_definitions d ON d.id = p.from_skill WHERE p.to_skill = $1',
    [skillId],
  )
  return rows
}

/**
 * Check cycle / duplicate open remediation before creating a child task (AC-19).
 */
export function detectTaskCycle(tasks, parentTask, targetSkillId, pauseReason = '') {
  if (!targetSkillId) return { cycleDetected: false }
  const byId = new Map(tasks.map((t) => [t.id, t]))
  // 1. Check active ancestry for A -> B -> A loop
  let cursor = parentTask
  const visited = new Set()
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id)
    if (cursor.skill_id === targetSkillId) {
      return { cycleDetected: true, reason: `技能「${targetSkillId}」已存在于当前主/子任务路径中，避免陷入循环补习。` }
    }
    cursor = cursor.parent_task_id ? byId.get(cursor.parent_task_id) : null
  }
  // 2. Check unresolved identical (goal_id + skill_id + pause_reason)
  const duplicateOpen = tasks.find((t) =>
    ['active', 'paused', 'created'].includes(t.status) &&
    t.goal_id === parentTask?.goal_id &&
    t.skill_id === targetSkillId &&
    (!pauseReason || t.pause_reason === pauseReason),
  )
  if (duplicateOpen) {
    return { cycleDetected: true, reason: `目标下已存在尚未完成的「${duplicateOpen.title}」任务，无需重复创建。`, existingTask: duplicateOpen }
  }
  return { cycleDetected: false }
}

export async function createRemedialTask(tx, {
  conversationId,
  learnerId,
  parentTask,
  targetSkillId,
  title,
  pauseReason,
  frameSnapshot,
}) {
  const { rows: tasks } = await tx.query('SELECT * FROM learning_tasks WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId])
  const cycle = detectTaskCycle(tasks, parentTask, targetSkillId, pauseReason)
  if (cycle.cycleDetected) {
    return { blocked: true, cycleDetected: true, reason: cycle.reason, existingTask: cycle.existingTask }
  }

  const nextDepth = (parentTask?.depth ?? 0) + 1
  const depthWarning = nextDepth >= MAX_RECOMMENDED_REMEDIATION_DEPTH

  if (parentTask) {
    await tx.query(
      "UPDATE learning_tasks SET status = 'paused', pause_reason = $2, resume_frame = $3::jsonb, updated_at = now() WHERE id = $1",
      [parentTask.id, pauseReason || '前置基础补习', JSON.stringify(frameSnapshot || null)],
    )
  }

  const childId = randomUUID()
  const child = (await tx.query(
    'INSERT INTO learning_tasks (id, conversation_id, learner_id, goal_id, parent_task_id, skill_id, title, status, depth, pause_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [childId, conversationId, learnerId, parentTask?.goal_id || null, parentTask?.id || null, targetSkillId, title, 'active', nextDepth, pauseReason || ''],
  )).rows[0]

  return { blocked: false, child, depthWarning }
}

export async function resumeParentTask(tx, { conversationId, currentTaskId, outcome = 'completed' }) {
  const { rows: tasks } = await tx.query('SELECT * FROM learning_tasks WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId])
  const current = tasks.find((t) => t.id === currentTaskId) || tasks.findLast((t) => t.status === 'active')
  if (!current || !current.parent_task_id) return { resumed: false }

  await tx.query('UPDATE learning_tasks SET status = $2, updated_at = now() WHERE id = $1', [current.id, outcome === 'completed' ? 'completed' : 'paused'])
  const parent = (await tx.query("UPDATE learning_tasks SET status = 'active', updated_at = now() WHERE id = $1 RETURNING *", [current.parent_task_id])).rows[0]
  return {
    resumed: true,
    closedChild: current,
    parentTask: parent,
    resumeFrame: parent?.resume_frame || null,
  }
}
