// M10 Pedagogy Skill Registry & Curriculum Seeding
// Separates platform safety rules, teaching skills, and discipline skills with explicit versioning.

export const PROMPT_VERSION = 'v1.3-practice-checkpoint'

export const SKILL_VERSIONS = {
  platform_policy: '1.0.0',
  diagnose: '1.0.0',
  explain: '1.0.0',
  misconception_repair: '1.0.0',
  probe_reason: '1.0.0',
  visualize: '1.0.0',
  verify_transfer: '1.0.0',
  recap: '1.0.0',
  repair_offer: '1.0.0',
  resume: '1.0.0',
  'chem.equation_balancing': '1.0.0',
  'math.linear_equation': '1.0.0',
}

export const CURATED_SKILLS = [
  // Chemistry balancing prerequisite chain (P0 / AC-17)
  { id: 'chem.physical_chemical_change', subject: 'chemistry', title: '物理变化与化学变化', scope: '依据变化中是否生成新物质区分物理变化与化学变化', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chem.subscript_counting', subject: 'chemistry', title: '化学式下标与原子计数', scope: '识别化学式右下角下标，准确数出单个分子中各元素原子数（如 H₂O 中 H=2, O=1）', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chem.coefficient_meaning', subject: 'chemistry', title: '化学计量数（系数）含义', scope: '理解化学式前面的系数同时放大分子内所有原子（如 2H₂O 含 4 个 H、2 个 O），不改动下标', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chem.atom_conservation', subject: 'chemistry', title: '质量守恒与两边原子核对', scope: '比较反应物与生成物两侧每种元素的原子总数是否相等', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chem.equation_balancing', subject: 'chemistry', title: '化学方程式配平', scope: '通过调整最简整数系数使化学方程式左右两边各类原子总数守恒', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chem.stoichiometry_calc', subject: 'chemistry', title: '化学方程式比例计算', scope: '结合已配平的化学计量数进行物质比例与质量/物质的量计算', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },

  // Math linear equations prerequisite chain (P2 / AC-28 second subject adapter)
  { id: 'math.equality_balance', subject: 'math', title: '等式平衡性质', scope: '理解等式两边同时加减乘除同一个非零数时等量关系依然成立', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'math.one_step_eq', subject: 'math', title: '一步一元一次方程', scope: '通过移项或等式性质解出形如 x + a = b 或 kx = b 的方程', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'math.linear_eq', subject: 'math', title: '一元一次方程求解', scope: '移项合并同类项并把未知数代入原方程检验左右相等', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'math.linear_function', subject: 'math', title: '一次函数 y = kx + b 图像与性质', scope: '理解斜率 k 与截距 b 如何控制直线的倾斜方向、陡峭度与交点', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },

  { id: 'math.fraction.compare', subject: 'math', title: '分数大小比较', scope: '比较同一整体中的分数，区分分数的大小和取出的实际量', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'math.function.monotonicity', subject: 'math', title: '函数单调性', scope: '在给定区间内比较自变量与函数值的变化方向', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'english.present_simple_agreement', subject: 'english', title: '一般现在时的主谓一致', scope: '在一般现在时中按主语使用正确的动词形式', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },

  // Additional starter catalog skills for multi-subject Catalog browsing
  { id: 'physics.force_analysis', subject: 'physics', title: '受力分析与牛顿定律', scope: '按顺序找重力、弹力、摩擦力并建立平衡或运动方程', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'english.clause_parsing', subject: 'english', title: '英语长难句主干拆解', scope: '先抓主谓宾主干，再识别定语/状语从句修饰关系', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
  { id: 'chinese.main_idea', subject: 'chinese', title: '现代文段落主旨概括', scope: '从关键词与情感脉络提炼段落中心意思，不以偏概全', criteria: { minCorrect: 1, requireExplanation: true, requireTransfer: true }, source_type: 'curated' },
]

export const CURATED_PREREQUISITES = [
  // Chemistry chain: subscript -> coefficient -> atom_conservation -> equation_balancing -> stoichiometry_calc
  { id: 'pre-chem-1', from_skill: 'chem.subscript_counting', to_skill: 'chem.coefficient_meaning', strength: 'hard' },
  { id: 'pre-chem-2', from_skill: 'chem.coefficient_meaning', to_skill: 'chem.atom_conservation', strength: 'hard' },
  { id: 'pre-chem-3', from_skill: 'chem.atom_conservation', to_skill: 'chem.equation_balancing', strength: 'hard' },
  { id: 'pre-chem-4', from_skill: 'chem.equation_balancing', to_skill: 'chem.stoichiometry_calc', strength: 'soft' },

  // Math chain: equality_balance -> one_step_eq -> linear_eq -> linear_function
  { id: 'pre-math-1', from_skill: 'math.equality_balance', to_skill: 'math.one_step_eq', strength: 'hard' },
  { id: 'pre-math-2', from_skill: 'math.one_step_eq', to_skill: 'math.linear_eq', strength: 'hard' },
  { id: 'pre-math-3', from_skill: 'math.linear_eq', to_skill: 'math.linear_function', strength: 'soft' },
]

export async function seedCurriculumCatalog(db) {
  for (const s of CURATED_SKILLS) {
    await db.query(
      'INSERT INTO skill_definitions (id, subject, title, scope, criteria, version, status, source_type) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET title=excluded.title, scope=excluded.scope, criteria=excluded.criteria, version=excluded.version',
      [s.id, s.subject, s.title, s.scope, JSON.stringify(s.criteria), '1.0', 'published', s.source_type],
    )
  }
  for (const p of CURATED_PREREQUISITES) {
    await db.query(
      'INSERT INTO prerequisite_relations (id, from_skill, to_skill, strength, source, version) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO UPDATE SET strength=excluded.strength',
      [p.id, p.from_skill, p.to_skill, p.strength, 'curated_v1', '1.0'],
    )
  }
}

export function inferSkillId(subjectId, text = '', activeTask = null) {
  if (activeTask?.skill_id) return activeTask.skill_id
  const s = String(text)
  if (subjectId === 'chemistry') {
    if (/物理变化|化学变化|有无新物质|是否生成新物质/.test(s)) return 'chem.physical_chemical_change'
    if (/下标|H2O|H₂O|O2|O₂|几个.*原子|数原子|分子组成/.test(s)) return 'chem.subscript_counting'
    if (/系数|计量数|2H2O|2H₂O/.test(s)) return 'chem.coefficient_meaning'
    if (/守恒|左右.*相等|一样吗/.test(s)) return 'chem.atom_conservation'
    if (/配平|方程式/.test(s)) return 'chem.equation_balancing'
    if (/摩尔|物质的量|质量计算|计算/.test(s)) return 'chem.stoichiometry_calc'
    return null
  }
  if (subjectId === 'math') {
    if (/单调性|单调递[增减]|函数值.{0,14}(?:增大|减小)|(?:区间|自变量).{0,12}(?:递增|递减)/.test(s)) return 'math.function.monotonicity'
    if (/分数.*(?:大[小于]|小于|比较)|(?:比较|比).*分数|(?:二分之一|一半).*(?:四分之一|三分之一)|\\frac[^\n]{0,70}(?:哪|更|大|小|比较)/.test(s)) return 'math.fraction.compare'
    if (/天平|等式/.test(s)) return 'math.equality_balance'
    if (/斜率|截距|一次函数|图像/.test(s)) return 'math.linear_function'
    if (/方程/.test(s)) return 'math.linear_eq'
    if (/\bx\s*[+\-−]\s*\d+\s*=/.test(s)) return 'math.one_step_eq'
    return null
  }
  if (subjectId === 'physics' && /受力分析|牛顿定律/.test(s)) return 'physics.force_analysis'
  if (subjectId === 'english' && /一般现在时|主谓一致|第三人称单数|\b(?:he|she)\s+(?:walks?|go(?:es)?|play(?:s)?|like(?:s)?)\b/i.test(s)) return 'english.present_simple_agreement'
  if (subjectId === 'english' && /长难句|主谓宾|主干拆解/.test(s)) return 'english.clause_parsing'
  if (subjectId === 'chinese' && /段落主旨|中心思想|概括主旨/.test(s)) return 'chinese.main_idea'
  return null
}

export function selectTeachingSkills({ intent, adapter, hasPending, hasPausedParent }) {
  const loaded = ['platform_policy', 'diagnose', 'explain', 'probe_reason']
  if (intent === 'answer_followup' || intent === 'exploration') loaded.push('misconception_repair', 'verify_transfer')
  if (hasPending) loaded.push('visualize', 'repair_offer')
  if (hasPausedParent) loaded.push('resume')
  if (adapter?.subjectId === 'chemistry') loaded.push('chem.equation_balancing')
  if (adapter?.subjectId === 'math') loaded.push('math.linear_equation')
  const versions = {}
  for (const name of loaded) versions[name] = SKILL_VERSIONS[name] || '1.0.0'
  return { loaded, versions }
}
