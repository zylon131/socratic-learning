// M08 Second Subject Adapter: Junior/High Math Deterministic Rule Engine (Gate 3 / AC-28)
// Proves the core learning engine (M02/M04/M05/M06) works uniformly without chemistry-only special cases.

export const ruleVersion = 'math-rule-v1.0'
export const subjectId = 'math'

/**
 * Deterministically verify linear equation solution ax + b = cx + d or expression numeric value.
 */
export function verifyLinearSolution(equationStr, candidateX) {
  const cleaned = String(equationStr || '').replace(/\s+/g, '')
  const sides = cleaned.split('=')
  if (sides.length !== 2 || !Number.isFinite(Number(candidateX))) return { supported: false }

  const evalLinearSide = (expr, xVal) => {
    // Support safe terms like 2x, -3x, +5, -11, x
    const normalized = expr.replace(/−/g, '-').replace(/^-/, '0-')
    const tokens = normalized.match(/[+-]?[^+-]+/g)
    if (!tokens) return null
    let total = 0
    for (const tok of tokens) {
      if (tok.endsWith('x') || tok.endsWith('X')) {
        const coefStr = tok.slice(0, -1)
        const coef = coefStr === '' || coefStr === '+' ? 1 : coefStr === '-' ? -1 : Number(coefStr)
        if (!Number.isFinite(coef)) return null
        total += coef * xVal
      } else {
        const num = Number(tok)
        if (!Number.isFinite(num)) return null
        total += num
      }
    }
    return total
  }

  const left = evalLinearSide(sides[0], Number(candidateX))
  const right = evalLinearSide(sides[1], Number(candidateX))
  if (left === null || right === null) return { supported: false }
  const diff = Math.abs(left - right)
  return {
    supported: true,
    left,
    right,
    balanced: diff <= 1e-6,
  }
}

export function evaluateExploration({ config, snapshot }) {
  if (config.component === 'balance') {
    const leftCount = Number(snapshot?.leftCount ?? config.left ?? 1)
    const unit = Number(config.unit || 1)
    const target = Number(config.target || 1)
    const leftTotal = leftCount * unit
    const balanced = Math.abs(leftTotal - target) <= 1e-6
    return {
      verdict: balanced ? 'correct' : 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: 'math.equality_balance',
      misconception: balanced ? null : 'equality_imbalance',
      fact: `天平实验设置左侧 ${leftCount} × ${unit} = ${leftTotal}，右侧目标为 ${target}，${balanced ? '两边相等成立' : '两边尚未相等'}。`,
      balanced,
    }
  }
  if (config.component === 'linear') {
    const slope = Number(snapshot?.slope ?? config.slope ?? 1)
    const intercept = Number(snapshot?.intercept ?? config.intercept ?? 0)
    return {
      verdict: 'observed',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId: 'math.linear_function',
      misconception: null,
      fact: `观察一次函数 y = ${slope}x ${intercept >= 0 ? `+ ${intercept}` : `- ${Math.abs(intercept)}`}。`,
    }
  }
  return {
    verdict: 'observed',
    evidenceSource: 'rule_engine',
    ruleVersion,
    skillId: 'math.equality_balance',
    misconception: null,
    fact: '完成数学可视化参数探索。',
  }
}

export function evaluateAnswer({ question, value, answerText }) {
  const promptText = String(question?.prompt || '')
  let skillId = 'math.linear_eq'
  if (/天平|等式/.test(promptText)) skillId = 'math.equality_balance'
  else if (/斜率|截距|图像|一次函数/.test(promptText)) skillId = 'math.linear_function'
  else if (/x\s*[+-]\s*\d+\s*=/.test(promptText)) skillId = 'math.one_step_eq'

  if (question?.type === 'choice' || question?.type === 'multi_choice') {
    const correct = question.type === 'multi_choice'
      ? Array.isArray(value) && Array.isArray(question.answer) && value.length === question.answer.length && [...value].sort().every((v, i) => v === [...question.answer].sort()[i])
      : value === question.answer
    const isUnknown = Boolean(question.isUnknown)
    return {
      verdict: isUnknown ? 'uncertain' : correct ? 'correct' : 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId,
      misconception: correct || isUnknown ? null : 'equation_reasoning_error',
      fact: `数学题「${promptText}」作答「${answerText}」，客观判定${isUnknown ? '待补充前置基础' : correct ? '正确' : '不正确'}。`,
    }
  }
  if (question?.type === 'number') {
    const correct = Math.abs(Number(value) - Number(question.answer)) <= (question.tolerance ?? 0)
    return {
      verdict: correct ? 'correct' : 'incorrect',
      evidenceSource: 'rule_engine',
      ruleVersion,
      skillId,
      misconception: correct ? null : 'calculation_or_transposition',
      fact: `数值题「${promptText}」作答 ${value}，确定性规则判定${correct ? '正确' : `不正确（标准值 ${question.answer}）`}。`,
    }
  }
  return {
    verdict: 'observed',
    evidenceSource: 'llm_semantic',
    ruleVersion,
    skillId,
    misconception: null,
    fact: `提交开放解答「${String(answerText || '').slice(0, 200)}」，等待结合上下文评估。`,
  }
}

export const mathAdapter = {
  subjectId,
  ruleVersion,
  supportsDeterministicCheck: true,
  verifyLinearSolution,
  evaluateExploration,
  evaluateAnswer,
}
