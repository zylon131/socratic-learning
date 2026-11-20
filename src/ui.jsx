import React, { createContext, useContext, useMemo } from 'react'

export const LearnerContext = createContext('')
export function useLearnerApi() {
  const id = useContext(LearnerContext)
  return useMemo(() => (path, options) => api(path, options, id), [id])
}

export async function api(path, options, learnerId) {
  const response = await fetch('/api' + path, {
    method: options ? options.method || 'POST' : 'GET',
    headers: { ...(options ? { 'Content-Type': 'application/json' } : {}), ...(learnerId ? { 'X-Learner-Id': learnerId } : {}) },
    ...(options ? { body: JSON.stringify(options.body ?? {}) } : {}),
  })
  const value = await response.json()
  if (!response.ok) throw Object.assign(new Error(value.error || '加载失败，请重试。'), { status: response.status })
  return value
}

export const subjectLink = (id, conversation) => '#/subject/' + id + (conversation ? '/' + conversation : '')

export function SubjectIcon({ subject }) {
  return <span className={'subject-icon ' + subject.color} aria-hidden="true">{subject.symbol}</span>
}

export function Notice({ text }) {
  return text && <p className="notice" role="alert">{text}</p>
}
