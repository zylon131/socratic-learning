import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { subjects } from './subjects.js'

export const taxonomySource = 'cn-math-taxonomy'
export const taxonomyAttribution = {
  name: 'cn-math-taxonomy',
  author: 'xiaoyang111222',
  repository: 'https://github.com/xiaoyang111222/cn-math-taxonomy',
  license: 'CC BY-NC 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/',
}

export const taxonomyPreviewEnabled = Boolean(process.env.CURRICULUM_TAXONOMY_FILE)
const supportedSubjects = new Set(subjects.map(({ id }) => id))
const appSubject = (subject) => subject === 'morality' ? 'civics' : (subject || 'math')
export const isTaxonomySkill = (id) => /^[a-z-]+\.cn[a-z]+_[a-z0-9_]+$/i.test(id || '')

export function validateTaxonomyPreviewConfig() {
  if (!taxonomyPreviewEnabled) return
  const host = process.env.HOST || '127.0.0.1'
  const dataDir = process.env.LOCAL_DATA_DIR
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.DATABASE_URL || !dataDir || resolve(dataDir) === resolve('.local/db')) {
    throw new Error('知识图谱仅供本机非商业预览，请使用回环监听及独立 LOCAL_DATA_DIR。')
  }
}

export async function seedCurriculumTaxonomy(db) {
  if (!taxonomyPreviewEnabled) {
    const { rows } = await db.query('SELECT 1 FROM skill_definitions WHERE source_type = $1 LIMIT 1', [taxonomySource])
    if (rows.length) throw new Error('当前数据库为非商业知识图谱预览库。请切换正式应用的数据目录。')
    return
  }

  const { source, topics, dependencies } = JSON.parse(await readFile(resolve(process.env.CURRICULUM_TAXONOMY_FILE), 'utf8'))
  if (source?.repository !== taxonomyAttribution.repository || source.license !== taxonomyAttribution.license || !/^[a-f0-9]{40}$/.test(source.commit) || !Array.isArray(topics) || !topics.length || !Array.isArray(dependencies)) {
    throw new Error('知识图谱缺少来源、版本或必要数据。')
  }
  const subjectById = new Map(topics.map((topic) => [topic.id, appSubject(topic.subject)]))
  if (subjectById.size !== topics.length || topics.some((topic) => !isTaxonomySkill(`${appSubject(topic.subject)}.${topic.id}`) || !supportedSubjects.has(appSubject(topic.subject)) || typeof topic.name !== 'string' || !topic.name.trim() || typeof topic.description !== 'string')) {
    throw new Error('知识图谱含有重复或无效的知识点。')
  }
  if (dependencies.some((edge) => !subjectById.has(edge.topicId) || !subjectById.has(edge.prerequisiteId) || edge.topicId === edge.prerequisiteId || subjectById.get(edge.topicId) !== subjectById.get(edge.prerequisiteId) || !['soft', 'hard'].includes(edge.strength))) {
    throw new Error('知识图谱含有无效先修关系。')
  }

  const definitions = topics.map((topic) => ({
    id: `${appSubject(topic.subject)}.${topic.id}`,
    subject: appSubject(topic.subject),
    title: topic.name,
    scope: topic.description,
    criteria: {
      grade: topic.grade,
      semester: topic.semester,
      chapter: topic.chapter,
      domain: topic.domain,
      suggestedCriteria: topic.mastery_criteria || [],
    },
  }))
  const edges = dependencies.map((edge) => ({
    id: `${taxonomySource}:${edge.prerequisiteId}:${edge.topicId}`,
    prerequisite: `${subjectById.get(edge.prerequisiteId)}.${edge.prerequisiteId}`,
    topic: `${subjectById.get(edge.topicId)}.${edge.topicId}`,
    strength: edge.strength,
  }))

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO skill_definitions (id, subject, title, scope, criteria, version, status, source_type)
       SELECT id, subject, title, scope, criteria, $2, 'reference', $3
       FROM jsonb_to_recordset($1::jsonb) AS t(id text, subject text, title text, scope text, criteria jsonb)
       ON CONFLICT (id) DO UPDATE SET title=excluded.title, scope=excluded.scope, criteria=excluded.criteria, version=excluded.version`,
      [JSON.stringify(definitions), source.commit, taxonomySource],
    )
    await tx.query(
      `INSERT INTO prerequisite_relations (id, from_skill, to_skill, strength, source, version)
       SELECT id, prerequisite, topic, strength, $2, $3
       FROM jsonb_to_recordset($1::jsonb) AS e(id text, prerequisite text, topic text, strength text)
       ON CONFLICT (id) DO UPDATE SET strength=excluded.strength, version=excluded.version`,
      [JSON.stringify(edges), taxonomySource, source.commit],
    )
  })
  console.log(`知识图谱预览已加载 ${definitions.length} 个知识点、${edges.length} 条先修关系。`)
}

export async function matchCurriculumTopic(db, text, subject) {
  if (!taxonomyPreviewEnabled || !text) return null
  const { rows } = await db.query(
    'SELECT id, subject, title FROM skill_definitions WHERE source_type=$1 AND title=$2 AND ($3::text IS NULL OR subject=$3) LIMIT 2',
    [taxonomySource, text.trim(), subject || null],
  )
  return rows.length === 1 ? rows[0] : null
}

export async function readCurriculumTopicContext(db, skillId) {
  if (!taxonomyPreviewEnabled || !isTaxonomySkill(skillId)) return null
  const { rows: [topic] } = await db.query(
    'SELECT id, title, scope, criteria FROM skill_definitions WHERE id=$1 AND source_type=$2',
    [skillId, taxonomySource],
  )
  if (!topic) return null
  const { rows: prerequisites } = await db.query(
    `SELECT p.from_skill AS id, d.title, p.strength FROM prerequisite_relations p
     JOIN skill_definitions d ON d.id=p.from_skill WHERE p.to_skill=$1 AND p.source=$2
     ORDER BY p.strength, p.id LIMIT 6`,
    [skillId, taxonomySource],
  )
  return { ...topic, prerequisites, usage: '第三方课程参考，需依据学生本轮作答核对理解。先修关系用于提供候选诊断方向，不代表学生必须重学。' }
}
