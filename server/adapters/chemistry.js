// M08 Chemistry Deterministic Subject Adapter & Rule Engine
// Handles chemical formula parsing, atom counting, equation balancing validation,
// simplest-integer-ratio verification, subscript-tampering checks, and misconception mapping.

export const ruleVersion = 'chem-rule-v1.0'
export const subjectId = 'chemistry'

const SUBSCRIPT_MAP = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' }

export function normalizeFormulaInput(raw) {
  return String(raw || '')
    .trim()
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (ch) => SUBSCRIPT_MAP[ch] || ch)
    .replace(/\s+/g, '')
}

/**
 * Deterministically parse a chemical species like "2H2O", "Ca(OH)2", "Fe3O4", "Al2(SO4)3".
 * Returns { coeff, formula, atoms } or { error }.
 */
export function parseSpecies(raw) {
  const cleaned = normalizeFormulaInput(raw)
  if (!cleaned || cleaned.length > 40) return { error: '化学式不能为空或过长。' }
  const match = /^(\d*)(.+)$/.exec(cleaned)
  if (!match) return { error: `无法解析化学式「${raw}」。` }
  const coeff = match[1] ? Number(match[1]) : 1
  const formula = match[2]
  if (!Number.isInteger(coeff) || coeff < 1 || coeff > 50) return { error: `化学计量数「${match[1]}」超出合理范围。` }

  // Parse parentheses and element counts via stack
  const stack = [{}]
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]
    if (ch === '(' || ch === '[') {
      stack.push({})
      i++
    } else if (ch === ')' || ch === ']') {
      if (stack.length < 2) return { error: `化学式「${formula}」括号不匹配。` }
      i++
      let numStr = ''
      while (i < formula.length && /\d/.test(formula[i])) numStr += formula[i++]
      const mult = numStr ? Number(numStr) : 1
      if (!Number.isInteger(mult) || mult < 1 || mult > 50) return { error: `化学式「${formula}」下标数字无效。` }
      const top = stack.pop()
      const parent = stack[stack.length - 1]
      for (const [el, count] of Object.entries(top)) {
        parent[el] = (parent[el] || 0) + count * mult
      }
    } else if (/[A-Z]/.test(ch)) {
      let el = ch
      i++
      if (i < formula.length && /[a-z]/.test(formula[i])) el += formula[i++]
      let numStr = ''
      while (i < formula.length && /\d/.test(formula[i])) numStr += formula[i++]
      const count = numStr ? Number(numStr) : 1
      if (!Number.isInteger(count) || count < 1 || count > 50) return { error: `元素「${el}」的下标无效。` }
      const top = stack[stack.length - 1]
      top[el] = (top[el] || 0) + count
    } else {
      return { error: `化学式「${formula}」包含不支持的字符「${ch}」。` }
    }
  }
  if (stack.length !== 1 || Object.keys(stack[0]).length === 0) return { error: `无法解析化学式「${formula}」。` }
  return { coeff, formula, atoms: stack[0] }
}

export function parseEquation(raw) {
  const normalized = String(raw || '').replace(/->|⟶|＝|=/g, '→')
  const sides = normalized.split('→')
  if (sides.length !== 2) return { error: '化学方程式应包含反应物、箭头（→）和生成物。' }
  const parseSide = (sideStr) => {
    const parts = sideStr.split('+').map((s) => s.trim()).filter(Boolean)
    if (!parts.length || parts.length > 5) return { error: '反应物或生成物项数不合法。' }
    const out = []
    for (const part of parts) {
      const parsed = parseSpecies(part)
      if (parsed.error) return parsed
      out.push(parsed)
    }
    return { species: out }
  }
  const left = parseSide(sides[0])
  if (left.error) return left
  const right = parseSide(sides[1])
  if (right.error) return right
  return { reactants: left.species, products: right.species }
}

const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
const gcdList = (nums) => nums.reduce((acc, n) => gcd(acc, n))

/**
 * Deterministically compute left/right element totals, conservation status,
 * simplest-integer-ratio status, and whether subscripts were tampered with.
 */
export function checkConservation(reactants, products, reference = null) {
  const sumSide = (list) => {
    const totals = {}
    for (const sp of list) {
      const coeff = sp.coeff || 1
      for (const [el, count] of Object.entries(sp.atoms || {})) {
        totals[el] = (totals[el] || 0) + coeff * count
      }
    }
    return totals
  }

  const leftTotals = sumSide(reactants)
  const rightTotals = sumSide(products)
  const elements = [...new Set([...Object.keys(leftTotals), ...Object.keys(rightTotals)])]
  const differences = []
  for (const el of elements) {
    const left = leftTotals[el] || 0
    const right = rightTotals[el] || 0
    if (left !== right) differences.push({ element: el, left, right })
  }

  const allCoeffs = [...reactants, ...products].map((sp) => Number(sp.coeff || 1))
  const validIntegerCoeffs = allCoeffs.every((c) => Number.isInteger(c) && c >= 1)
  const coeffGcd = validIntegerCoeffs && allCoeffs.length > 0 ? gcdList(allCoeffs) : 1
  const simplest = validIntegerCoeffs && coeffGcd === 1
  const balanced = validIntegerCoeffs && elements.length > 0 && differences.length === 0

  let subscriptTampered = false
  if (reference) {
    const normList = (arr) => arr.map((s) => normalizeFormulaInput(s.formula)).join('+')
    if (normList(reactants) !== normList(reference.reactants || []) || normList(products) !== normList(reference.products || [])) {
      subscriptTampered = true
    }
  }

  return {
    leftTotals,
    rightTotals,
    elements,
    differences,
    balanced,
    simplest,
    subscriptTampered,
    validIntegerCoeffs,
  }
}

export const misconceptionCatalog = {
  subscript_confusion: {
    skillId: 'chem.subscript_counting',
    label: '混淆下标与系数（或通过改写化学式下标来配平）',
  },
  coefficient_scaling: {
    skillId: 'chem.coefficient_meaning',
    label: '调整系数时未同步放大分子内的所有原子',
  },
  partial_conservation: {
    skillId: 'chem.atom_conservation',
    label: '只配平了某一种原子，忽略了另一元素不守恒',
  },
  non_simplest_ratio: {
    skillId: 'chem.equation_balancing',
    label: '两边原子相等但系数未化简为最简整数比',
  },
}

/**
 * Recompute deterministic atom counts for LLM-proposed equation blocks.
 */
export function normalizeEquationBlock(block) {
  const sanitizeList = (arr) => {
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > 4) return null
    const out = []
    for (const sp of arr) {
      if (!sp || typeof sp !== 'object' || typeof sp.formula !== 'string') return null
      const parsed = parseSpecies(sp.formula)
      if (parsed.error) return null
      const coeff = Number.isInteger(sp.coeff) && sp.coeff >= 1 && sp.coeff <= 12 ? sp.coeff : parsed.coeff
      out.push({ formula: parsed.formula, coeff, atoms: parsed.atoms })
    }
    return out
  }
  const reactants = sanitizeList(block.reactants)
  const products = sanitizeList(block.products)
  if (!reactants || !products) return null
  const conservation = checkConservation(reactants, products)
  return { reactants, products, conservation }
}

export function evaluateExploration({ config, snapshot, explanation = '' }) {
  const reactants = (config.reactants || []).map((sp, i) => ({
    ...sp,
    coeff: Number(snapshot?.leftCoeffs?.[i] ?? sp.coeff ?? 1),
  }))
  const products = (config.products || []).map((sp, i) => ({
    ...sp,
    coeff: Number(snapshot?.rightCoeffs?.[i] ?? sp.coeff ?? 1),
  }))

  const check = checkConservation(reactants, products, config)
  const formatEq = (list) => list.map((s) => (s.coeff > 1 ? s.coeff : '') + s.formula).join(' + ')
  const equationText = `${formatEq(reactants)} → ${formatEq(products)}`
  const countsSummary = check.elements.map((el) => `${el}(左${check.leftTotals[el] || 0}:右${check.rightTotals[el] || 0})`).join('，')

  if (check.subscriptTampered) {
    return {
      verdict: 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: 'chem.subscript_counting',
      misconception: 'subscript_confusion',
      fact: `提交的方程式「${equationText}」修改了化学式本身或下标。配平只能修改化学式前面的系数，不能改动化学式下标。`,
      balanced: false,
      simplest: false,
      check,
      equationText,
    }
  }

  if (!check.balanced) {
    const partial = check.elements.some((el) => (check.leftTotals[el] || 0) === (check.rightTotals[el] || 0))
    const expIndicatesAwareness = /没配平|不守恒|不一样|不等|还差|氢.*不/.test(explanation)
    return {
      verdict: expIndicatesAwareness ? 'partial' : 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: partial ? 'chem.atom_conservation' : 'chem.coefficient_meaning',
      misconception: partial ? 'partial_conservation' : 'coefficient_scaling',
      fact: `当前组合「${equationText}」各原子数量：${countsSummary}。尚有 ${check.differences.map((d) => `${d.element}(左${d.left}≠右${d.right})`).join('、')} 未守恒。`,
      balanced: false,
      simplest: false,
      check,
      equationText,
    }
  }

  if (!check.simplest) {
    return {
      verdict: 'partial',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: 'chem.equation_balancing',
      misconception: 'non_simplest_ratio',
      fact: `当前组合「${equationText}」原子数量已相等（${countsSummary}），但系数公约数大于 1，尚未化为最简整数比。`,
      balanced: true,
      simplest: false,
      check,
      equationText,
    }
  }

  return {
    verdict: 'correct',
    evidenceSource: 'rule_engine',
    ruleVersion,
    skillId: 'chem.equation_balancing',
    misconception: null,
    fact: `化学规则校验通过：「${equationText}」满足原子守恒（${countsSummary}），且为最简整数系数。`,
    balanced: true,
    simplest: true,
    check,
    equationText,
  }
}

export function evaluateAnswer({ question, value, answerText, explanation = '' }) {
  const promptText = String(question?.prompt || '')
  if (question?.type === 'choice' || question?.type === 'multi_choice') {
    const correct = question.type === 'multi_choice'
      ? Array.isArray(value) && Array.isArray(question.answer) && value.length === question.answer.length && [...value].sort().every((v, i) => v === [...question.answer].sort()[i])
      : value === question.answer
    const isUnknown = Boolean(question.isUnknown)
    const badExplanation = /改下标|下标改成|不需要守恒|瞎猜|猜的/.test(explanation)
    const verdict = isUnknown ? 'uncertain' : (correct && badExplanation ? 'partial' : correct ? 'correct' : 'incorrect')
    let skillId = 'chem.equation_balancing'
    if (/下标|H₂O|H2O|几个.*原子|数量/.test(promptText)) skillId = 'chem.subscript_counting'
    else if (/系数|2H₂O|2H2O|计量数/.test(promptText)) skillId = 'chem.coefficient_meaning'
    else if (/守恒|一样吗|相等/.test(promptText)) skillId = 'chem.atom_conservation'
    return {
      verdict,
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId,
      misconception: !correct && !isUnknown ? (skillId === 'chem.subscript_counting' ? 'subscript_confusion' : 'partial_conservation') : null,
      fact: isUnknown
        ? `在题目「${promptText}」中选择了「${answerText}」，需补习前置计数概念。`
        : `题目「${promptText}」作答「${answerText}」，客观判定为${correct ? '正确' : '不正确'}。${badExplanation ? '（注意：提交的理由存在概念误区）' : ''}`,
    }
  }
  if (question?.type === 'number') {
    const correct = Math.abs(Number(value) - Number(question.answer)) <= (question.tolerance ?? 0)
    const skillId = /2[A-Z]|系数/.test(promptText) ? 'chem.coefficient_meaning' : /原子|下标/.test(promptText) ? 'chem.subscript_counting' : 'chem.equation_balancing'
    return {
      verdict: correct ? 'correct' : 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId,
      misconception: correct ? null : 'coefficient_scaling',
      fact: `数值题「${promptText}」作答 ${value}，确定性规则判定${correct ? '正确' : `不正确（标准值 ${question.answer}）`}。`,
    }
  }
  // Open short_answer
  const trimmed = String(answerText || '').trim()
  if (/改.*下标|把.*2.*下标/.test(trimmed)) {
    return {
      verdict: 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: 'chem.subscript_counting',
      misconception: 'subscript_confusion',
      fact: `学生自由作答提出「${trimmed.slice(0, 120)}」，检测到修改化学式下标的典型误区。`,
    }
  }
  return {
    verdict: 'observed',
    evidenceSource: 'llm_semantic',
    ruleVersion,
    skillId: 'chem.atom_conservation',
    misconception: null,
    fact: `提交自由作答「${trimmed.slice(0, 200)}」，待结合教学规则与语义评估确认理解。`,
  }
}

export const chemistryAdapter = {
  subjectId,
  ruleVersion,
  supportsDeterministicCheck: true,
  parseSpecies,
  parseEquation,
  checkConservation,
  normalizeEquationBlock,
  evaluateExploration,
  evaluateAnswer,
  misconceptionCatalog,
}
