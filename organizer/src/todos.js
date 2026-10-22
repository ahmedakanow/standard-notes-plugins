// Pure Todos logic: no DOM, so it can be tested in Node. A Todos note is plain Markdown:
//
//   - [ ] Renew passport (2026-10-01, due 2026-11-15) #admin
//   - [ ] Call the plumber (2026-10-22) #home
//
//   ## Parked
//   - [ ] Learn Spanish (2026-08-01) #personal
//
//   ## Done
//   - [x] Buy milk (2026-10-20, done 2026-10-21) #home
//
// The first date is when the todo was last touched; the stale clock counts from it.
// Only the text is required, so `- [ ] buy bread` typed on a phone is a valid todo.

import { addDays, isIsoDate } from './dates.js'

export const DEFAULT_STALE_DAYS = 14
export const REVIEW_EVERY_DAYS = 7

const ITEM_LINE = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*?)\s*$/
const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const TRAILING_TAGS = /((?:\s+#\p{L}[\p{L}\p{N}_-]*)+)$/u
const TRAILING_DETAILS = /\s*\(([^()]*)\)$/
const DETAIL = /^(?:(due|done)\s+)?(\S+)$/

let nextId = 1

function splitTags(text) {
  const match = TRAILING_TAGS.exec(text)
  if (!match) return { text, tags: [] }
  const tags = match[1].trim().split(/\s+/).map((tag) => tag.slice(1).toLowerCase())
  return { text: text.slice(0, match.index).trim(), tags: [...new Set(tags)] }
}

/** Reads `(2026-10-01, due 2026-11-15)` off the end; anything else in brackets stays text. */
function splitDetails(text) {
  const match = TRAILING_DETAILS.exec(text)
  if (!match) return { text, details: {} }
  const details = {}
  for (const part of match[1].split(',')) {
    const detail = DETAIL.exec(part.trim())
    const key = detail?.[1] ?? 'touched'
    if (!detail || !isIsoDate(detail[2]) || details[key]) return { text, details: {} }
    details[key] = detail[2]
  }
  return { text: text.slice(0, match.index).trim(), details }
}

function parseItem(line, section) {
  const match = ITEM_LINE.exec(line)
  if (!match || !match[2]) return null
  const tagged = splitTags(match[2])
  const { text, details } = splitDetails(tagged.text)
  if (!text) return null
  const checked = match[1] === 'x' || match[1] === 'X'
  return {
    id: nextId++,
    text,
    tags: tagged.tags,
    status: checked ? 'done' : section === 'parked' ? 'parked' : 'active',
    touched: details.touched ?? null,
    due: details.due ?? null,
    done: details.done ?? null,
  }
}

function tidyBlock(lines) {
  return lines
    .join('\n')
    .replace(/(?:[ \t]*\n){3,}/g, '\n\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '')
}

export function parseTodos(body, meta = {}) {
  const items = []
  const other = [] // anything that isn't a todo, kept verbatim
  let section = 'active'
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const name = heading[1].toLowerCase()
      section = name === 'parked' || name === 'done' ? name : 'other'
      if (section === 'other') other.push(line)
      continue
    }
    const item = section === 'other' ? null : parseItem(line, section)
    if (item) items.push(item)
    else other.push(line)
  }
  return { items, other: tidyBlock(other), reviewed: isIsoDate(meta.reviewed) ? meta.reviewed : null }
}

function formatItem(item) {
  const details = [
    item.touched,
    item.due && `due ${item.due}`,
    item.status === 'done' && item.done && `done ${item.done}`,
  ].filter(Boolean)
  const box = item.status === 'done' ? '[x]' : '[ ]'
  const detailText = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `- ${box} ${item.text}${detailText}${item.tags.map((tag) => ` #${tag}`).join('')}`
}

export function serializeTodos(model, today) {
  const { active, parked, done } = sections(model, today)
  const blocks = []
  if (active.length > 0) blocks.push(active.map(formatItem).join('\n'))
  if (parked.length > 0) blocks.push(['## Parked', ...parked.map(formatItem)].join('\n'))
  if (done.length > 0) blocks.push(['## Done', ...done.map(formatItem)].join('\n'))
  if (model.other) blocks.push(model.other)
  return { body: blocks.join('\n\n'), meta: { reviewed: model.reviewed } }
}

export function isStale(item, today, staleDays = DEFAULT_STALE_DAYS) {
  return item.status === 'active' && !item.due && item.touched <= addDays(today, -staleDays)
}

/** Dates hand-typed todos and parks stale ones. Returns whether anything changed. */
export function normalizeTodos(model, { today, staleDays = DEFAULT_STALE_DAYS }) {
  let changed = false
  for (const item of model.items) {
    if (!item.touched) {
      item.touched = today
      changed = true
    }
    if (item.status === 'done' && !item.done) {
      item.done = today
      changed = true
    }
    if (item.status !== 'done' && item.done) {
      item.done = null
      changed = true
    }
    if (isStale(item, today, staleDays)) {
      item.status = 'parked'
      changed = true
    }
  }
  return changed
}

const newestFirst = (a, b) => (a === b ? 0 : (a ?? '') < (b ?? '') ? 1 : -1)
const activeRank = (item, today) => (!item.due ? 2 : item.due < today ? 0 : 1)

function compareActive(today) {
  return (a, b) => {
    const rank = activeRank(a, today) - activeRank(b, today)
    if (rank !== 0) return rank
    if (a.due && b.due) return a.due === b.due ? 0 : a.due < b.due ? -1 : 1
    return newestFirst(a.touched, b.touched)
  }
}

/** Overdue first, then by due date, then newest. Parked and done show newest first. */
export function sections(model, today) {
  const withStatus = (status) => model.items.filter((item) => item.status === status)
  return {
    active: withStatus('active').sort(compareActive(today)),
    parked: withStatus('parked').sort((a, b) => newestFirst(a.touched, b.touched)),
    done: withStatus('done').sort((a, b) => newestFirst(a.done, b.done)),
  }
}

/** One todo per line; list markers and checkboxes from a pasted list are dropped. */
export function parseInput(input) {
  return input
    .split(/\r?\n/)
    .map((line) => parseItem(`- ${line.replace(LIST_PREFIX, '')}`, 'active'))
    .filter(Boolean)
}

export function addTodos(model, input, { today, due = null }) {
  const added = parseInput(input).map((item) => ({ ...item, touched: today, due: item.due ?? due, done: null }))
  model.items.push(...added)
  return added
}

/** Updates a todo from its edited text (`text #tags`). Returns false if the text is empty. */
export function editTodo(item, input, today) {
  const [parsed] = parseInput(input)
  if (!parsed) return false
  item.text = parsed.text
  item.tags = parsed.tags
  item.touched = today
  return true
}

export function complete(item, today) {
  item.status = 'done'
  item.done = today
}

export function reopen(item, today) {
  item.status = 'active'
  item.done = null
  item.touched = today
}

export function park(item) {
  item.status = 'parked'
}

export function bringBack(item, today) {
  item.status = 'active'
  item.touched = today
}

export function setDue(item, due, today) {
  item.due = due || null
  item.touched = today
}

export function removeTodo(model, item) {
  model.items = model.items.filter((candidate) => candidate !== item)
}

export function reviewDue(model, today) {
  const hasParked = model.items.some((item) => item.status === 'parked')
  return hasParked && (!model.reviewed || model.reviewed <= addDays(today, -REVIEW_EVERY_DAYS))
}

export function markReviewed(model, today) {
  model.reviewed = today
}

export function allTags(model) {
  return [...new Set(model.items.flatMap((item) => item.tags))].sort()
}

/** Plain-text summary for the Standard Notes note list. */
export function previewTodos(model, today) {
  const { active, parked } = sections(model, today)
  if (model.items.length === 0) return 'No todos yet'
  const overdue = active.filter((item) => item.due && item.due < today).length
  return [
    `${active.length} to do`,
    overdue > 0 && `${overdue} overdue`,
    parked.length > 0 && `${parked.length} parked`,
    active[0] && `Next: ${active[0].text}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
