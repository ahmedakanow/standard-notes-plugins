// Pure Todos logic: no DOM, so it can be tested in Node. A Todos note is plain Markdown:
//
//   - [ ] Work out (2026-10-01, every day, done 2026-10-21, streak 4) #health
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
//
// Repeating todos ("every day", "every mon wed fri") form the routine. They are never
// parked and never move to Done: they keep the last day they were done and a streak of
// scheduled days done in a row. Their checkbox only shows whether they're done today.

import { addDays, isIsoDate, weekdayOf } from './dates.js'

export const DEFAULT_STALE_DAYS = 14
export const REVIEW_EVERY_DAYS = 7
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const ITEM_LINE = /^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.*?)\s*$/
const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/
const TRAILING_TAGS = /((?:\s+#\p{L}[\p{L}\p{N}_-]*)+)$/u
const TRAILING_DETAILS = /\s*\(([^()]*)\)$/
const WEEKDAYS = [1, 2, 3, 4, 5]
const DAY_WORDS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
}

let nextId = 1

/** Reads the schedule after "every": `day`, `weekday`, or day names like `mon wed fri`. */
export function parseDays(text) {
  const words = text.toLowerCase().split(/[\s/]+/).filter(Boolean)
  if (words.length === 1 && words[0] === 'day') return [...EVERY_DAY]
  if (words.length === 1 && (words[0] === 'weekday' || words[0] === 'weekdays')) return [...WEEKDAYS]
  const days = words.map((word) => DAY_WORDS[word])
  if (days.length === 0 || days.includes(undefined)) return null
  return [...new Set(days)].sort((a, b) => a - b)
}

export function formatDays(days) {
  if (days.length === 7) return 'day'
  if (days.join() === WEEKDAYS.join()) return 'weekday'
  return WEEK_ORDER.filter((day) => days.includes(day))
    .map((day) => DAY_NAMES[day].slice(0, 3).toLowerCase())
    .join(' ')
}

/** 'Every day', 'Weekdays' or 'Mon, Wed, Fri'. */
export function describeDays(days) {
  if (days.length === 7) return 'Every day'
  if (days.join() === WEEKDAYS.join()) return 'Weekdays'
  return WEEK_ORDER.filter((day) => days.includes(day))
    .map((day) => DAY_NAMES[day].slice(0, 3))
    .join(', ')
}

export const isScheduled = (iso, days) => days.includes(weekdayOf(iso))

/** The latest scheduled day before `iso`. */
export function previousScheduled(iso, days) {
  for (let back = 1; back <= 7; back++) {
    const candidate = addDays(iso, -back)
    if (isScheduled(candidate, days)) return candidate
  }
  return null
}

/** The next scheduled day after `iso`. */
export function nextScheduled(iso, days) {
  for (let ahead = 1; ahead <= 7; ahead++) {
    const candidate = addDays(iso, ahead)
    if (isScheduled(candidate, days)) return candidate
  }
  return null
}

function splitTags(text) {
  const match = TRAILING_TAGS.exec(text)
  if (!match) return { text, tags: [] }
  const tags = match[1].trim().split(/\s+/).map((tag) => tag.slice(1).toLowerCase())
  return { text: text.slice(0, match.index).trim(), tags: [...new Set(tags)] }
}

function readDetail(part) {
  if (isIsoDate(part)) return ['touched', part]
  const dated = /^(due|done)\s+(\S+)$/i.exec(part)
  if (dated && isIsoDate(dated[2])) return [dated[1].toLowerCase(), dated[2]]
  const every = /^every\s+(.+)$/i.exec(part)
  const days = every && parseDays(every[1])
  if (days) return ['repeat', days]
  const streak = /^streak\s+(\d+)$/i.exec(part)
  if (streak) return ['streak', Number(streak[1])]
  return null
}

/** Reads `(2026-10-01, every day, due …, done …, streak 4)` off the end; anything else in brackets stays text. */
function splitDetails(text) {
  const match = TRAILING_DETAILS.exec(text)
  if (!match) return { text, details: {} }
  const details = {}
  for (const part of match[1].split(',')) {
    const detail = readDetail(part.trim())
    if (!detail || detail[0] in details) return { text, details: {} }
    details[detail[0]] = detail[1]
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
  const repeat = details.repeat ?? null
  return {
    id: nextId++,
    text,
    tags: tagged.tags,
    // A repeating todo's checkbox just mirrors "done today", so it doesn't decide its status.
    status: repeat ? 'active' : checked ? 'done' : section === 'parked' ? 'parked' : 'active',
    touched: details.touched ?? null,
    due: details.due ?? null,
    done: details.done ?? null,
    repeat,
    streak: details.streak ?? 0,
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

function formatItem(item, today) {
  const isDone = item.repeat ? item.done === today : item.status === 'done'
  const details = [
    item.touched,
    item.repeat && `every ${formatDays(item.repeat)}`,
    !item.repeat && item.due && `due ${item.due}`,
    (item.repeat || item.status === 'done') && item.done && `done ${item.done}`,
    item.repeat && item.streak > 0 && `streak ${item.streak}`,
  ].filter(Boolean)
  const detailText = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `- [${isDone ? 'x' : ' '}] ${item.text}${detailText}${item.tags.map((tag) => ` #${tag}`).join('')}`
}

export function serializeTodos(model, today) {
  const { routine, active, parked, done } = sections(model, today)
  const format = (item) => formatItem(item, today)
  const blocks = []
  if (routine.length + active.length > 0) blocks.push([...routine, ...active].map(format).join('\n'))
  if (parked.length > 0) blocks.push(['## Parked', ...parked.map(format)].join('\n'))
  if (done.length > 0) blocks.push(['## Done', ...done.map(format)].join('\n'))
  if (model.other) blocks.push(model.other)
  return { body: blocks.join('\n\n'), meta: { reviewed: model.reviewed } }
}

export function isStale(item, today, staleDays = DEFAULT_STALE_DAYS) {
  return item.status === 'active' && !item.repeat && !item.due && item.touched <= addDays(today, -staleDays)
}

/**
 * Dates hand-typed todos, parks stale ones and ends broken streaks.
 * Returns whether anything changed.
 */
export function normalizeTodos(model, { today, staleDays = DEFAULT_STALE_DAYS }) {
  let changed = false
  for (const item of model.items) {
    if (!item.touched) {
      item.touched = today
      changed = true
    }
    if (item.repeat) {
      const missedADay = !item.done || item.done < previousScheduled(today, item.repeat)
      if (item.streak > 0 && missedADay) {
        item.streak = 0
        changed = true
      }
      continue
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

/**
 * Routine (repeating todos, in the order they were written), then active todos (overdue
 * first, then by due date, then newest), parked and done (newest first).
 */
export function sections(model, today) {
  const oneOff = (status) => model.items.filter((item) => !item.repeat && item.status === status)
  return {
    routine: model.items.filter((item) => item.repeat),
    active: oneOff('active').sort(compareActive(today)),
    parked: oneOff('parked').sort((a, b) => newestFirst(a.touched, b.touched)),
    done: oneOff('done').sort((a, b) => newestFirst(a.done, b.done)),
  }
}

/** The routine split into what's on today (scheduled, or already done today) and the rest. */
export function routineFor(model, today) {
  const { routine } = sections(model, today)
  const isToday = (item) => isScheduled(today, item.repeat) || item.done === today
  return { today: routine.filter(isToday), later: routine.filter((item) => !isToday(item)) }
}

/** One todo per line; list markers and checkboxes from a pasted list are dropped. */
export function parseInput(input) {
  return input
    .split(/\r?\n/)
    .map((line) => parseItem(`- ${line.replace(LIST_PREFIX, '')}`, 'active'))
    .filter(Boolean)
}

export function addTodos(model, input, { today, due = null }) {
  const added = parseInput(input).map((item) => ({
    ...item,
    touched: today,
    due: item.repeat ? null : (item.due ?? due),
    done: null,
    streak: 0,
  }))
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

/** Makes a todo repeat on `days` (weekday numbers), or stop repeating with null or []. */
export function setRepeat(item, days, today) {
  if (days && days.length > 0) {
    item.repeat = [...new Set(days)].sort((a, b) => a - b)
    item.status = 'active'
    item.due = null
    if (!item.repeat.includes(weekdayOf(today)) && item.done === today) item.done = null
  } else {
    item.repeat = null
    item.done = null
    item.streak = 0
  }
  item.touched = today
}

/** Ticks a repeating todo for today and extends its streak if the last scheduled day was done. */
export function doToday(item, today) {
  if (item.done === today) return
  const keptStreak = item.done && item.done >= previousScheduled(today, item.repeat)
  item.streak = keptStreak ? item.streak + 1 : 1
  item.done = today
}

/** Unticks today, returning the streak to where it was. */
export function undoToday(item, today) {
  if (item.done !== today) return
  item.streak = Math.max(0, item.streak - 1)
  item.done = item.streak > 0 ? previousScheduled(today, item.repeat) : null
}

export function removeTodo(model, item) {
  model.items = model.items.filter((candidate) => candidate !== item)
}

export function reviewDue(model, today) {
  const hasParked = model.items.some((item) => item.status === 'parked' && !item.repeat)
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
  if (model.items.length === 0) return 'No todos yet'
  const { active, parked } = sections(model, today)
  const routine = routineFor(model, today).today
  const overdue = active.filter((item) => item.due && item.due < today).length
  return [
    routine.length > 0 && `Routine ${routine.filter((item) => item.done === today).length}/${routine.length}`,
    `${active.length} to do`,
    overdue > 0 && `${overdue} overdue`,
    parked.length > 0 && `${parked.length} parked`,
    active[0] && `Next: ${active[0].text}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
