import React, { useId, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, HelpCircle, Lightbulb, RotateCw, Shuffle, Sparkles } from 'lucide-react'

const latexSymbols = {
  '\\times': '×', '\\div': '÷', '\\cdot': '·', '\\pm': '±', '\\mp': '∓',
  '\\leq': '≤', '\\le': '≤', '\\geq': '≥', '\\ge': '≥', '\\neq': '≠', '\\ne': '≠',
  '\\approx': '≈', '\\equiv': '≡', '\\propto': '∝', '\\infty': '∞',
  '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftrightarrow': '⇔',
  '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\Delta': 'Δ',
  '\\theta': 'θ', '\\lambda': 'λ', '\\mu': 'μ', '\\pi': 'π', '\\sigma': 'σ', '\\omega': 'ω', '\\Omega': 'Ω',
  '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\partial': '∂', '\\nabla': '∇',
  '\\degree': '°', '\\circ': '°', '\\triangle': '△', '\\angle': '∠', '\\perp': '⊥', '\\parallel': '∥',
}

export function cleanMathString(raw) {
  if (!raw) return ''
  let s = String(raw)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]+)\}/g, '$1')
    .replace(/\\_/g, '＿')
    .replace(/\\(?:left|right)\s*([()[\]|])/g, '$1')
  for (const [k, v] of Object.entries(latexSymbols)) s = s.split(k).join(v)
  return s.replace(/\\([a-zA-Z]+)/g, '$1')
}

export function renderMathNodes(expr, keyPrefix = 'm') {
  const cleaned = cleanMathString(expr)
  const tokens = cleaned.split(/(\^\{[^{}]+\}|\^[0-9a-zA-Z+-]+|_\{[^{}]+\}|_[0-9a-zA-Z+-]+)/g)
  return tokens.map((tok, i) => {
    if (!tok) return null
    if (tok.startsWith('^')) {
      const content = tok.startsWith('^{') ? tok.slice(2, -1) : tok.slice(1)
      return <sup key={`${keyPrefix}-${i}`}>{content}</sup>
    }
    if (tok.startsWith('_')) {
      const content = tok.startsWith('_{') ? tok.slice(2, -1) : tok.slice(1)
      return <sub key={`${keyPrefix}-${i}`}>{content}</sub>
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{tok}</React.Fragment>
  })
}

export function renderInlineRich(text, keyPrefix = 'inl') {
  if (!text) return null
  const parts = String(text).split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
  return parts.map((part, idx) => {
    if (!part) return null
    const k = `${keyPrefix}-${idx}`
    if (part.startsWith('$$') && part.endsWith('$$')) {
      return <span key={k} className="math-inline math-display-inline">{renderMathNodes(part.slice(2, -2).trim(), k)}</span>
    }
    if (part.startsWith('$') && part.endsWith('$')) {
      return <span key={k} className="math-inline">{renderMathNodes(part.slice(1, -1).trim(), k)}</span>
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={k}>{renderInlineRich(part.slice(2, -2), k)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={k} className="inline-code">{part.slice(1, -1)}</code>
    }
    return <React.Fragment key={k}>{part}</React.Fragment>
  })
}

// Markdown-ish renderer for teacher prose: headings, lists, tables, code fences,
// dividers, display formulas and paragraphs. Content is rendered through the
// same allowlisted inline renderer as before - never raw HTML.
function renderProseBlocks(text, keyPrefix = 'tx') {
  const lines = String(text || '').split('\n')
  const out = []
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed) { i++; continue }
    if (trimmed.startsWith('```')) {
      const code = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i++ }
      i++
      out.push(<pre key={`${keyPrefix}-code-${k++}`} className="prose-code"><code>{code.join('\n')}</code></pre>)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) { out.push(<hr key={`${keyPrefix}-hr-${k++}`} className="prose-divider" />); i++; continue }
    const heading = trimmed.match(/^(#{2,4})\s+(.+)$/)
    if (heading) { out.push(<h4 key={`${keyPrefix}-h-${k++}`} className="prose-heading">{renderInlineRich(heading[2], `${keyPrefix}h${k}`)}</h4>); i++; continue }
    if (trimmed.startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const rows = []
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i++ }
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (rows.length >= 2) {
        const head = cells(rows[0])
        const body = rows.slice(2).map(cells)
        out.push(<table key={`${keyPrefix}-tb-${k++}`} className="prose-table"><thead><tr>{head.map((c, ci) => <th key={ci}>{renderInlineRich(c, `${keyPrefix}t${k}h${ci}`)}</th>)}</tr></thead><tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInlineRich(c, `${keyPrefix}t${k}r${ri}c${ci}`)}</td>)}</tr>)}</tbody></table>)
        continue
      }
    }
    if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length > 4) {
      out.push(<div key={`${keyPrefix}-f-${k++}`} className="lesson-formula">{renderMathNodes(trimmed.slice(2, -2).trim(), `${keyPrefix}f${k}`)}</div>)
      i++
      continue
    }
    const group = [line]
    i++
    while (i < lines.length) {
      const nxt = lines[i]
      const nt = nxt.trim()
      if (!nt || nt.startsWith('```') || nt.startsWith('|') || /^(#{2,4})\s+/.test(nt) || /^(-{3,}|\*{3,})$/.test(nt) || (nt.startsWith('$$') && nt.endsWith('$$'))) break
      const prev = group[group.length - 1].trim()
      const sameList = /^\s*[-*•]\s+/.test(prev) && /^\s*[-*•]\s+/.test(nt)
      const sameNum = /^\s*\d+[.、)]\s+/.test(prev) && /^\s*\d+[.、)]\s+/.test(nt)
      if (sameList || sameNum) { group.push(nxt); i++; continue }
      if (/^\s*[-*•]\s+/.test(nt) || /^\s*\d+[.、)]\s+/.test(nt)) break
      group.push(nxt)
      i++
    }
    const gLines = group
    const isBulletList = gLines.length > 1 && gLines.every((l) => /^\s*[-*•]\s+/.test(l))
    if (isBulletList) {
      out.push(<ul key={`${keyPrefix}-ul-${k++}`} className="prose-list">{gLines.map((l, j) => <li key={j}>{renderInlineRich(l.replace(/^\s*[-*•]\s+/, ''), `${keyPrefix}u${k}${j}`)}</li>)}</ul>)
      continue
    }
    const isNumberedList = gLines.length > 1 && gLines.every((l) => /^\s*\d+[.、)]\s+/.test(l))
    if (isNumberedList) {
      out.push(<ol key={`${keyPrefix}-ol-${k++}`} className="prose-list">{gLines.map((l, j) => <li key={j}>{renderInlineRich(l.replace(/^\s*\d+[.、)]\s+/, ''), `${keyPrefix}o${k}${j}`)}</li>)}</ol>)
      continue
    }
    out.push(<p key={`${keyPrefix}-p-${k++}`}>{gLines.map((line, j) => <React.Fragment key={j}>{j > 0 && <br />}{renderInlineRich(line, `${keyPrefix}p${k}${j}`)}</React.Fragment>)}</p>)
  }
  return out
}

function Text({ props }) {
  return <div className="lesson-prose">{renderProseBlocks(props.text)}</div>
}

function Outline({ props }) {
  return <details className="lesson-outline-details">
    <summary>{props.title}</summary>
    <div className="lesson-outline"><div>{props.items.map((item, i) => <div className="outline-item" key={i}><strong>{item.title}</strong><p>{renderInlineRich(item.detail, `out-${i}`)}</p></div>)}</div></div>
  </details>
}

function Plan({ props }) {
  return <section className="lesson-plan"><h3>{props.title}</h3><ol>{props.items.map((item, i) => <li key={i}><strong>{item.title}</strong><p>{renderInlineRich(item.detail, `plan-${i}`)}</p></li>)}</ol><small className="muted">根据本次学习提出的建议，后续会随你的表现动态调整。</small></section>
}

function Level({ props, response, interactive, busy, onEvent }) {
  const [value, setValue] = useState(props.selected || '')
  const name = useId()
  const action = response.actions.find((a) => a.id === props.actionId)
  if (!interactive && props.selected) {
    return <div className="level-summary-pill"><span>学习起点：<strong>{props.selected}</strong></span></div>
  }
  return <form className="lesson-choice lesson-level compact-level" onSubmit={(e) => { e.preventDefault(); if (value && action) onEvent(action, value) }}>
    <fieldset disabled={!interactive || busy}>
      <legend>{props.title}</legend>
      <div className="level-options">{props.options.map((option) => <label key={option} className={value === option ? 'selected' : ''}><input type="radio" name={name} checked={value === option} onChange={() => setValue(option)} /><span>{option}</span></label>)}</div>
    </fieldset>
    {interactive && action && <div className="level-footer"><button className="button primary" disabled={!value || busy}>{action.label}<ArrowRight size={15} /></button></div>}
  </form>
}

function Question({ props, type, response, interactive, busy, streaming, onEvent }) {
  const [value, setValue] = useState('')
  const [multi, setMulti] = useState([])
  const [unsure, setUnsure] = useState(false)
  const action = response.actions.find((a) => a.kind === 'answer.submit' && a.target === props.questionId)
  const enabled = interactive && !!action

  const toggleMulti = (idx) => {
    setMulti((prev) => (prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]))
  }

  const canSubmit = type === 'multi_choice'
    ? multi.length > 0
    : type === 'short_answer'
      ? value.trim().length > 0
      : value !== ''

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!enabled || busy || !canSubmit || type === 'choice') return
    if (type === 'multi_choice') onEvent(action, multi, unsure)
    else if (type === 'short_answer') onEvent(action, value.trim(), unsure)
    else onEvent(action, Number(value), unsure)
  }

  return <form className="lesson-choice question-card" onSubmit={handleSubmit}>
    <fieldset disabled={!enabled || busy}>
      <legend>{renderInlineRich(props.prompt, `q-${props.questionId}`)}</legend>
      {type === 'choice' && <div className="answer-options">{props.options.map((option, index) => <button type="button" key={index} className="option-choice" onClick={() => onEvent(action, index, unsure)}><span className="option-badge">{String.fromCharCode(65 + index)}</span><span>{renderInlineRich(option, `opt-${index}`)}</span></button>)}</div>}
      {type === 'multi_choice' && <div className="answer-options">{props.options.map((option, index) => <label key={index} className={multi.includes(index) ? 'selected' : ''}><input type="checkbox" checked={multi.includes(index)} onChange={() => toggleMulti(index)} /><span className="option-badge">{String.fromCharCode(65 + index)}</span><span>{renderInlineRich(option, `opt-${index}`)}</span></label>)}</div>}
      {type === 'number' && <label className="number-answer">你的答案<input type="number" aria-label="你的答案" step="any" min={-1000000} max={1000000} value={value} onChange={(e) => setValue(e.target.value)} placeholder="填一个数" required /></label>}
      {type === 'short_answer' && <label className="short-answer-field"><span>用自己的话写下思考过程</span><textarea rows={3} maxLength={2000} value={value} onChange={(e) => setValue(e.target.value)} placeholder="写出你的理由或关键步骤…" required /></label>}
    </fieldset>
    {enabled ? <div className="answer-submit">
      {type !== 'choice' && <button className="button primary" disabled={!canSubmit || busy}>{action.label}<ArrowRight size={16} /></button>}
      {type !== 'short_answer' && <label className={'unsure-toggle ' + (unsure ? 'active' : '')}><input type="checkbox" checked={unsure} onChange={(e) => setUnsure(e.target.checked)} /><HelpCircle size={14} /><span>不太确定</span></label>}
    </div> : streaming ? <small className="muted">老师正在生成这道题，稍候即可作答…</small> : <small className="muted">已完成作答（历史只读）</small>}
  </form>
}

function HintPanel({ props, interactive, onHintRequest }) {
  const [shown, setShown] = useState(1)
  const hints = props.hints || []
  const revealMore = () => {
    const next = Math.min(hints.length, shown + 1)
    setShown(next)
    onHintRequest?.(next)
  }
  return <section className="lesson-hint-panel">
    <header><strong><Lightbulb size={15} />{props.title || '分层提示'}</strong><span>{shown} / {hints.length} 层</span></header>
    <ol>{hints.slice(0, shown).map((h, i) => <li key={i}>{renderInlineRich(h, `hp-${i}`)}</li>)}</ol>
    {interactive && shown < hints.length && <button type="button" className="text-button" onClick={revealMore}>再看一层提示 →</button>}
  </section>
}

function StepVisualizer({ props }) {
  const [active, setActive] = useState(0)
  const steps = props.steps || []
  return <section className="lesson-step-visualizer">
    <header><strong>{props.title}</strong><span>{active + 1} / {steps.length}</span></header>
    <div className="step-tabs">{steps.map((s, i) => <button key={i} type="button" className={active === i ? 'active' : ''} onClick={() => setActive(i)}>{i + 1}. {s.label}</button>)}</div>
    {steps[active] && <div className="step-detail">
      {steps[active].formula && <div className="lesson-formula">{renderMathNodes(steps[active].formula, `sv-${active}`)}</div>}
      <p>{renderInlineRich(steps[active].detail, `svd-${active}`)}</p>
    </div>}
  </section>
}

function RepairOffer({ props, response, interactive, busy, streaming, onEvent }) {
  const acceptAct = response.actions.find((a) => a.id === props.acceptActionId)
  const rejectAct = response.actions.find((a) => a.id === props.rejectActionId)
  return <section className="lesson-repair-offer" role="region" aria-label="前置知识补习建议">
    <div>
      <span className="repair-badge">先修基础建议</span>
      <h3>需要先补一下「{props.title}」吗？</h3>
      <p>{renderInlineRich(props.reason, 'ro')}</p>
    </div>
    {interactive && (acceptAct || rejectAct) ? <div className="repair-actions">
      {acceptAct && <button type="button" className="button primary compact" disabled={busy} onClick={() => onEvent(acceptAct, true)}>{acceptAct.label}<ArrowRight size={14} /></button>}
      {rejectAct && <button type="button" className="button secondary compact" disabled={busy} onClick={() => onEvent(rejectAct, false)}>{rejectAct.label}</button>}
    </div> : streaming ? <small className="muted">建议生成中…</small> : <small className="muted">历史建议 · 已处理</small>}
  </section>
}

function Feedback({ props }) {
  const tone = props.neutral ? 'neutral' : props.correct ? 'correct' : 'hint'
  const title = props.neutral
    ? '我们先理清这个方法'
    : props.correct
      ? (props.unsure ? '答对了 · 我们来确认一下背后的理由' : '这一步答对了')
      : (props.attempt > 1 ? `第 ${props.attempt} 次尝试 · 我们再换个角度` : '思路很接近 · 再看一个关键线索')
  return <div className={'lesson-feedback ' + tone} role="status">
    {props.neutral ? <HelpCircle size={20} /> : props.correct ? <CheckCircle2 size={20} /> : <Lightbulb size={20} />}
    <div>
      <strong>{title}</strong>
      <p>{renderInlineRich(props.text, 'fb')}</p>
    </div>
  </div>
}

function Flashcards({ props, interactive, busy, onQuickPrompt }) {
  const [order, setOrder] = useState(() => props.cards.map((_, i) => i))
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [status, setStatus] = useState({})
  const currentIdx = order[index] ?? 0
  const card = props.cards[currentIdx] || props.cards[0]
  const masteredCount = Object.values(status).filter((v) => v === 'mastered').length

  function mark(state) {
    setStatus((prev) => ({ ...prev, [currentIdx]: state }))
    setFlipped(false)
    if (index < order.length - 1) setIndex(index + 1)
  }
  function shuffleCards() {
    const next = [...order]
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]]
    }
    setOrder(next)
    setIndex(0)
    setFlipped(false)
  }

  return <section className="lesson-flashcards" aria-label={props.title}>
    <header className="flashcards-head">
      <div>
        <span className="flashcard-badge">互动闪卡</span>
        <h3>{props.title}</h3>
      </div>
      <div className="flashcards-meta">
        <span>已掌握 {masteredCount} / {props.cards.length}</span>
        <button type="button" className="text-button" onClick={shuffleCards} title="打乱顺序"><Shuffle size={14} />洗牌</button>
      </div>
    </header>
    <div
      className={'flashcard-stage ' + (flipped ? 'is-flipped' : '') + ' ' + (status[currentIdx] || '')}
      role="button"
      tabIndex={0}
      aria-label={flipped ? '卡片背面，点击翻回正面' : '卡片正面，点击翻看答案'}
      onClick={() => setFlipped(!flipped)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFlipped(!flipped) } }}
    >
      <div className="flashcard-top">
        <span>第 {index + 1} / {order.length} 张 · {flipped ? '背面（解析与答案）' : '正面（先在心里想一想）'}</span>
        {card.tag && <em className="flashcard-tag">{card.tag}</em>}
      </div>
      <div className="flashcard-body">
        {renderInlineRich(flipped ? card.back : card.front, `fc-${currentIdx}-${flipped ? 'b' : 'f'}`)}
      </div>
      <div className="flashcard-foot">
        <span><RotateCw size={13} />点击卡片翻面</span>
        {status[currentIdx] && <strong>{status[currentIdx] === 'mastered' ? '✓ 已掌握' : '↻ 待巩固'}</strong>}
      </div>
    </div>
    <div className="flashcards-controls">
      <div className="flashcards-nav">
        <button type="button" className="button secondary compact" disabled={index === 0} onClick={() => { setIndex(index - 1); setFlipped(false) }}><ArrowLeft size={14} />上一张</button>
        <button type="button" className="button secondary compact" disabled={index >= order.length - 1} onClick={() => { setIndex(index + 1); setFlipped(false) }}>下一张<ArrowRight size={14} /></button>
      </div>
      <div className="flashcards-Rate">
        <button type="button" className="button secondary compact review-btn" onClick={() => mark('review')}><RotateCw size={14} />再巩固</button>
        <button type="button" className="button primary compact master-btn" onClick={() => mark('mastered')}><Check size={14} />记住了</button>
      </div>
    </div>
    {interactive && onQuickPrompt && <div className="flashcards-quiz-cta">
      <button type="button" className="text-button" disabled={busy} onClick={() => onQuickPrompt(`我已经看完了「${props.title}」的闪卡（目前已标记掌握 ${masteredCount}/${props.cards.length} 张），请出一道小题考考我能不能活学活用。`)}>让老师根据这组闪卡出题考考我 →</button>
    </div>}
  </section>
}

const atomColors = {
  H: { bg: '#f8fafc', border: '#64748b', text: '#0f172a' },
  O: { bg: '#fee2e2', border: '#dc2626', text: '#991b1b' },
  C: { bg: '#334155', border: '#0f172a', text: '#ffffff' },
  N: { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a' },
  Cl: { bg: '#dcfce7', border: '#16a34a', text: '#14532d' },
  Na: { bg: '#f3e8ff', border: '#9333ea', text: '#581c87' },
  Fe: { bg: '#ffedd5', border: '#ea580c', text: '#7c2d12' },
  S: { bg: '#fef9c3', border: '#ca8a04', text: '#713f12' },
}

function formatChemFormula(formula) {
  return String(formula || '').split(/(\d+)/g).map((part, i) => (/^\d+$/.test(part) ? <sub key={i}>{part}</sub> : <React.Fragment key={i}>{part}</React.Fragment>))
}

function EquationExplorer({ props, response, interactive, busy, streaming, onEvent, instancesMap, onDraftChange }) {
  const savedInstance = props.instanceId ? instancesMap?.[props.instanceId] : null
  const snap = !interactive ? savedInstance?.committed_snapshot : savedInstance?.draft_snapshot
  const [leftCoeffs, setLeftCoeffs] = useState(() => snap?.leftCoeffs || (props.reactants || []).map((s) => s.coeff || 1))
  const [rightCoeffs, setRightCoeffs] = useState(() => snap?.rightCoeffs || (props.products || []).map((s) => s.coeff || 1))
  const [note, setNote] = useState(() => snap?.note || '')

  const canManipulate = interactive && props.interactive !== false
  const submitAction = response?.actions?.find((a) => a.kind === 'exploration.submit' && a.target === props.instanceId)

  const countAtoms = (species, coeffs) => {
    const totals = {}
    species.forEach((sp, idx) => {
      const c = coeffs[idx] || 1
      for (const [el, n] of Object.entries(sp.atoms || {})) totals[el] = (totals[el] || 0) + c * n
    })
    return totals
  }
  const leftTotals = countAtoms(props.reactants || [], leftCoeffs)
  const rightTotals = countAtoms(props.products || [], rightCoeffs)
  const elements = [...new Set([...Object.keys(leftTotals), ...Object.keys(rightTotals)])]
  const balanced = elements.length > 0 && elements.every((el) => (leftTotals[el] || 0) === (rightTotals[el] || 0))
  const step = (side, idx, delta) => {
    if (!canManipulate) return
    const nextLeft = side === 'left' ? leftCoeffs.map((v, i) => (i === idx ? Math.min(12, Math.max(1, v + delta)) : v)) : leftCoeffs
    const nextRight = side === 'right' ? rightCoeffs.map((v, i) => (i === idx ? Math.min(12, Math.max(1, v + delta)) : v)) : rightCoeffs
    setLeftCoeffs(nextLeft)
    setRightCoeffs(nextRight)
    if (props.instanceId) onDraftChange?.(props.instanceId, { leftCoeffs: nextLeft, rightCoeffs: nextRight, note })
  }

  const renderSide = (species, coeffs, sideKey) => species.map((sp, idx) => (
    <React.Fragment key={`${sideKey}-${idx}`}>
      {idx > 0 && <span className="eq-plus">+</span>}
      <div className="eq-species">
        <div className="eq-molecules" aria-label={`${coeffs[idx]} 个 ${sp.formula}`}>
          {Array.from({ length: coeffs[idx] }, (_, m) => (
            <div className="eq-molecule" key={m}>
              {Object.entries(sp.atoms || {}).flatMap(([el, n]) => Array.from({ length: n }, (__, k) => {
                const palette = atomColors[el] || { bg: '#e0e7ff', border: '#4f46e5', text: '#312e81' }
                return <span key={`${el}-${k}`} className="eq-atom" style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}>{el}</span>
              }))}
            </div>
          ))}
        </div>
        <div className="eq-formula-row">
          {canManipulate && <button type="button" className="eq-step" aria-label={`减少 ${sp.formula} 系数`} onClick={() => step(sideKey, idx, -1)} disabled={coeffs[idx] <= 1 || busy}>−</button>}
          <strong className="eq-formula">{coeffs[idx] > 1 || canManipulate ? <span className="eq-coeff">{coeffs[idx]}</span> : null}{formatChemFormula(sp.formula)}</strong>
          {canManipulate && <button type="button" className="eq-step" aria-label={`增加 ${sp.formula} 系数`} onClick={() => step(sideKey, idx, 1)} disabled={coeffs[idx] >= 12 || busy}>+</button>}
        </div>
      </div>
    </React.Fragment>
  ))

  return <figure className="lesson-explorer eq-explorer">
    <figcaption>{props.title || '化学反应原子示意图'}</figcaption>
    <div className="eq-stage">
      <div className="eq-side">{renderSide(props.reactants || [], leftCoeffs, 'left')}</div>
      <span className="eq-arrow" aria-hidden="true">→</span>
      <div className="eq-side">{renderSide(props.products || [], rightCoeffs, 'right')}</div>
    </div>
    <div className="eq-counts">
      {elements.map((el) => {
        const l = leftTotals[el] || 0
        const r = rightTotals[el] || 0
        const ok = l === r
        return <div key={el} className={'eq-count-pill ' + (ok ? 'ok' : 'diff')}>
          <span>{el} 原子</span>
          <strong>左 {l} : 右 {r}</strong>
          <span>{ok ? '✓ 相等' : '≠ 不相等'}</span>
        </div>
      })}
      <div className={'eq-status ' + (balanced ? 'ok' : 'diff')}>{balanced ? '✓ 两边原子数量已相等' : '提示：原子总数目前还不相等'}</div>
    </div>
    <small className="eq-disclaimer">抽象原子数量示意图（非真实分子三维空间构型） · 拖动或点击只做本地试算，不消耗老师回合</small>
    {canManipulate && submitAction && <div className="exploration-submit-bar">
      <input
        type="text"
        aria-label="观察想法（可选）"
        placeholder="写一句你的观察（可选，例如：左边氧不够，先配平水）"
        maxLength={300}
        value={note}
        disabled={busy}
        onChange={(e) => {
          setNote(e.target.value)
          if (props.instanceId) onDraftChange?.(props.instanceId, { leftCoeffs, rightCoeffs, note: e.target.value })
        }}
      />
      <button type="button" className="button primary compact" disabled={busy} onClick={() => onEvent(submitAction, { leftCoeffs, rightCoeffs, note })}>{submitAction.label}<ArrowRight size={14} /></button>
    </div>}
    {!interactive && <small className="muted">{streaming ? '探索组件生成中…' : '历史探索记录 · 只读'}</small>}
  </figure>
}

function Explorer({ props, response, interactive, busy, streaming, onEvent, instancesMap, onDraftChange }) {
  const [ratio, setRatio] = useState(props.ratio || 2)
  const [selected, setSelected] = useState(props.selected || 1)
  const [slope, setSlope] = useState(props.slope ?? 1)
  const [intercept, setIntercept] = useState(props.intercept ?? 0)
  const [leftCount, setLeftCount] = useState(props.left || 2)

  if (props.component === 'equation') return <EquationExplorer props={props} response={response} interactive={interactive} busy={busy} streaming={streaming} onEvent={onEvent} instancesMap={instancesMap} onDraftChange={onDraftChange} />

  if (props.component === 'fraction') return <figure className="lesson-explorer">
    <figcaption>动态直观实验：把整体平均分成 {props.parts} 份</figcaption>
    <div className="fraction-bar" aria-label={`涂色 ${selected}/${props.parts}`} style={{ gridTemplateColumns: `repeat(${props.parts}, 1fr)` }}>{Array.from({ length: props.parts }, (_, i) => <span key={i} className={i < selected ? 'filled' : ''} />)}</div>
    <label>涂色的份数 <output>{selected} / {props.parts}（约 {Math.round((selected / props.parts) * 100)}%）</output><input type="range" min="1" max={props.parts} step="1" value={selected} onChange={(e) => setSelected(Number(e.target.value))} /></label>
    <small>拖动滑块实时观察分子与整体比例的变化</small>
  </figure>

  if (props.component === 'linear') {
    const x1 = -5, y1 = slope * x1 + intercept
    const x2 = 5, y2 = slope * x2 + intercept
    const toSvgX = (x) => 120 + x * 20
    const toSvgY = (y) => 90 - y * 14
    return <figure className="lesson-explorer">
      <figcaption>动态函数实验室：观察 y = {slope}x {intercept >= 0 ? `+ ${intercept}` : `- ${Math.abs(intercept)}`} 的图像变化</figcaption>
      <svg viewBox="0 0 240 180" className="explorer-svg" role="img" aria-label="一次函数图像">
        <line x1="20" y1="90" x2="220" y2="90" stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1="120" y1="10" x2="120" y2="170" stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={toSvgX(x1)} y1={toSvgY(y1)} x2={toSvgX(x2)} y2={toSvgY(y2)} stroke="#315acb" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={toSvgX(0)} cy={toSvgY(intercept)} r="4" fill="#e11d48" />
      </svg>
      <div className="explorer-sliders">
        <label>斜率 k（决定倾斜方向与陡峭度）<output>{slope}</output><input type="range" min="-3" max="3" step="0.5" value={slope} onChange={(e) => setSlope(Number(e.target.value))} /></label>
        <label>截距 b（与纵轴交点位置）<output>{intercept}</output><input type="range" min="-5" max="5" step="1" value={intercept} onChange={(e) => setIntercept(Number(e.target.value))} /></label>
      </div>
      <small>拖动滑块改变 k 和 b，直观感受函数公式与几何图像的对应关系</small>
    </figure>
  }

  if (props.component === 'balance') {
    const leftVal = leftCount * (props.unit || 3)
    const rightVal = props.target || 6
    const diff = leftVal - rightVal
    return <figure className="lesson-explorer">
      <figcaption>等式天平实验：调整左侧份数，让天平两边相等</figcaption>
      <div className="balance-stage">
        <div className="balance-side"><strong>{leftCount} × {props.unit} = {leftVal}</strong><span>左侧总计</span></div>
        <div className={'balance-indicator ' + (diff === 0 ? 'equal' : '')}>{diff === 0 ? '= 平衡！' : diff > 0 ? '> 左边偏重' : '< 右边偏重'}</div>
        <div className="balance-side"><strong>{rightVal}</strong><span>右侧目标</span></div>
      </div>
      <label>左侧份数 x <output>{leftCount}</output><input type="range" min="1" max="8" step="1" value={leftCount} onChange={(e) => setLeftCount(Number(e.target.value))} /></label>
      <small>拖动滑块寻找使等式成立的值</small>
    </figure>
  }

  const terms = Array.from({ length: 5 }, (_, i) => props.first * ratio ** i)
  return <figure className="lesson-explorer">
    <figcaption>动态规律实验：每一步乘以同一个数，会发生什么？</figcaption>
    <div className="sequence-values">{terms.map((term, i) => <React.Fragment key={i}>{i > 0 && <span aria-hidden="true">→</span>}<strong>{Number(term.toFixed(2))}</strong></React.Fragment>)}</div>
    <label>每一步的倍数（公比 q）<output>{ratio}</output><input type="range" min="1" max="4" step="0.5" value={ratio} onChange={(e) => setRatio(Number(e.target.value))} /></label>
    <small>拖动滑块实时观察数列的增长速度</small>
  </figure>
}

function Diagram({ props }) {
  return <figure className="lesson-diagram"><figcaption>{props.title}</figcaption><ul>{props.edges.map(([from, to], i) => <li key={i}><span>{renderInlineRich(props.nodes[from], `dn-f-${i}`)}</span><ArrowRight aria-label="指向" size={18} /><span>{renderInlineRich(props.nodes[to], `dn-t-${i}`)}</span></li>)}</ul></figure>
}

// Only renderers shipped by this product can run. Model output supplies data only.
const registry = {
  text: Text,
  notice: ({ props }) => <p className="muted" role="status">{props.text}</p>,
  formula: ({ props }) => <div className="lesson-formula">{renderMathNodes(props.text, 'formula')}</div>,
  outline: Outline,
  plan: Plan,
  level: Level,
  choice: Question,
  multi_choice: Question,
  number: Question,
  short_answer: Question,
  hint_panel: HintPanel,
  step_visualizer: StepVisualizer,
  repair_offer: RepairOffer,
  feedback: Feedback,
  flashcards: Flashcards,
  explorer: Explorer,
  diagram: Diagram,
  options: ({ props }) => <div className="lesson-options-heading"><h3>{props.title}</h3><p className="muted">{props.hint}</p></div>,
}

export function LearningResponse({ response, interactive = false, busy, streaming = false, onEvent, onTeacher, onQuickPrompt, instancesMap, onDraftChange, onHintRequest }) {
  const teacherRequests = response.actions.filter((a) => a.kind === 'teacher.request')
  const hasSubmit = response.actions.some((a) => a.kind === 'answer.submit')
  const isTopicStarters = teacherRequests.length > 1 && !hasSubmit
  return <div className="learning-response">
    {response.presentation.map((block, index) => {
      const Component = registry[block.type]
      return Component
        ? <Component key={block.props?.questionId || block.props?.instanceId || index} type={block.type} props={block.props} response={response} interactive={interactive} busy={busy} streaming={streaming} onEvent={onEvent} onQuickPrompt={onQuickPrompt} instancesMap={instancesMap} onDraftChange={onDraftChange} onHintRequest={onHintRequest} />
        : <p key={index} className="muted" role="status">当前版本无法显示这段教学内容。</p>
    })}
    {interactive && teacherRequests.length > 0 && <div className={'teacher-actions ' + (isTopicStarters ? 'topic-starter-chips' : '')}>
      {teacherRequests.map((action, i) => <button className={isTopicStarters ? 'topic-chip' : 'button compact ' + (i === 0 && !hasSubmit ? 'primary' : 'secondary')} key={action.id} onClick={() => onTeacher(action)} disabled={busy}>{action.label}<ArrowRight size={14} /></button>)}
    </div>}
  </div>
}

export function TeacherMessage({ children, badge }) {
  return <div className="teacher-entry"><span className="teacher-avatar" aria-hidden="true"><Sparkles size={16} /></span><div className="teacher-content">{badge && <div className="teacher-meta"><span className="study-mode-pill">{badge}</span></div>}{children}</div></div>
}
