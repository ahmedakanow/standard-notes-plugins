// Pure Notebook logic: no DOM, so it can be tested in Node. A Notebook note is one topic
// as a tree of sections, written as Markdown headings:
//
//   Anything before the first heading is the topic's introduction.
//
//   ## Sleep
//   <!-- edited 2026-10-23 -->
//   Notes about sleep…
//
//   ### Morning routine
//   Wake at 7…
//
// `##` is the top level and `######` the fifth. The hidden `edited` line records when a
// section's own name or text last changed. In a section's text, lines that would read as
// headings are escaped (`\## …`) so they stay text.

import { isIsoDate, shortDate } from './dates.js'
import { toggleChecklist } from './markdown.js'

export const MAX_DEPTH = 5
export const UNSORTED = 'Unsorted'
const TITLE_LENGTH = 80

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{2,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const ANY_HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const EDITED = /^<!--\s*edited\s+(\d{4}-\d{2}-\d{2})\s*-->\s*$/

let nextId = 1

const tidy = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')

export function createSection(title, text = '', edited = null) {
  return { id: nextId++, title, text, edited, children: [] }
}

export function cleanTitle(title) {
  return String(title)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/\s+#+$/, '')
    .trim()
}

/** A title from a line, shortened at a word if it's long. `overflow` means it was cut. */
function titleFromLine(line) {
  const title = cleanTitle(line) || 'Untitled'
  if (title.length <= TITLE_LENGTH) return { title, overflow: false }
  const cut = title.slice(0, TITLE_LENGTH)
  return { title: `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : TITLE_LENGTH).trimEnd()}…`, overflow: true }
}

export function parseNotebook(body) {
  const intro = []
  const sections = []
  const stack = [] // stack[n] is the open section at depth n + 1
  const texts = new Map()
  let current = null
  let expectEdited = false
  let inFence = false

  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE.test(line)) inFence = !inFence
    const heading = !inFence && HEADING.exec(line)
    if (heading) {
      // Levels can't be skipped: a `####` straight under a `##` becomes its child.
      const depth = Math.min(heading[1].length - 1, stack.length + 1)
      stack.length = depth - 1
      current = createSection(cleanTitle(heading[2]) || 'Untitled')
      ;(depth === 1 ? sections : stack.at(-1).children).push(current)
      stack.push(current)
      texts.set(current, [])
      expectEdited = true
      continue
    }
    if (current && expectEdited) {
      expectEdited = false
      const edited = EDITED.exec(line)
      if (edited && isIsoDate(edited[1])) {
        current.edited = edited[1]
        continue
      }
    }
    const text = inFence ? line : line.replace(/^\\(?=#{2,6}[ \t])/, '') // see escapeHeadings
    if (current) texts.get(current).push(text)
    else intro.push(text)
  }
  for (const [section, lines] of texts) section.text = tidy(lines.join('\n'))
  return { intro: tidy(intro.join('\n')), sections }
}

/** Escapes lines in a section's text that would otherwise be read back as headings. */
function escapeHeadings(text) {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) inFence = !inFence
      return !inFence && /^#{2,6}[ \t]/.test(line) ? `\\${line}` : line
    })
    .join('\n')
}

export function serializeNotebook(model) {
  const blocks = []
  if (model.intro) blocks.push(escapeHeadings(model.intro))
  const write = (section, depth) => {
    const lines = [`${'#'.repeat(depth + 1)} ${section.title}`]
    if (section.edited) lines.push(`<!-- edited ${section.edited} -->`)
    if (section.text) lines.push(escapeHeadings(section.text))
    blocks.push(lines.join('\n'))
    for (const child of section.children) write(child, depth + 1)
  }
  for (const section of model.sections) write(section, 1)
  return { body: blocks.join('\n\n'), meta: {} }
}

/** Every section in reading order, with where it sits: { section, parent, list, index, depth }. */
export function walk(model) {
  const entries = []
  const visit = (list, parent, depth) =>
    list.forEach((section, index) => {
      entries.push({ section, parent, list, index, depth })
      visit(section.children, section, depth + 1)
    })
  visit(model.sections, null, 1)
  return entries
}

export const locate = (model, id) => walk(model).find((entry) => entry.section.id === id) ?? null

/** The sections from the top level down to `id`, inclusive. */
export function pathTo(model, id) {
  const path = []
  let entry = locate(model, id)
  while (entry) {
    path.unshift(entry.section)
    entry = entry.parent ? locate(model, entry.parent.id) : null
  }
  return path
}

/** Levels a section takes up, counting itself. */
export const height = (section) => 1 + Math.max(0, ...section.children.map(height))

/** How many sections are inside, at any depth. */
export const countInside = (section) => section.children.reduce((total, child) => total + 1 + countInside(child), 0)

export const findUnsorted = (model) =>
  model.sections.find((section) => section.title.toLowerCase() === UNSORTED.toLowerCase()) ?? null

/**
 * Turns typed or pasted text into a section: the first line is the name and the rest its
 * text. Headings in the rest become sub-sections; any deeper than `room` levels below it
 * become bold lines instead.
 */
export function sectionFromText(input, today, room = MAX_DEPTH - 1) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first === -1) return null
  const { title, overflow } = titleFromLine(lines[first])
  const section = createSection(title, '', today)
  const rest = overflow ? [lines[first], ...lines.slice(first + 1)] : lines.slice(first + 1)

  let inFence = false
  const levels = []
  for (const line of rest) {
    if (FENCE.test(line)) inFence = !inFence
    else if (!inFence && ANY_HEADING.test(line)) levels.push(ANY_HEADING.exec(line)[1].length)
  }
  const top = Math.min(...levels) // Infinity when there are none

  const texts = new Map([[section, []]])
  const stack = [section]
  inFence = false
  for (const line of rest) {
    if (FENCE.test(line)) inFence = !inFence
    const heading = !inFence && ANY_HEADING.exec(line)
    if (heading) {
      const depth = Math.min(heading[1].length - top + 1, stack.length)
      if (depth > room) {
        texts.get(stack.at(-1)).push(`**${cleanTitle(heading[2])}**`)
        continue
      }
      stack.length = depth
      const child = createSection(cleanTitle(heading[2]) || 'Untitled', '', today)
      stack.at(-1).children.push(child)
      stack.push(child)
      texts.set(child, [])
      continue
    }
    texts.get(stack.at(-1)).push(line)
  }
  for (const [part, partLines] of texts) part.text = tidy(partLines.join('\n'))
  return section
}

/** Adds a section from typed or pasted text at the end of `parentId` (null for the top). */
export function addSection(model, parentId, input, today) {
  const parent = parentId === null ? null : locate(model, parentId)
  const depth = parent ? parent.depth + 1 : 1
  if (depth > MAX_DEPTH) return null
  const section = sectionFromText(input, today, MAX_DEPTH - depth)
  if (section) (parent ? parent.section.children : model.sections).push(section)
  return section
}

/** Adds a quick thought as its own small section at the top of Unsorted, creating it if needed. */
export function addThought(model, input, today) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first === -1) return null
  const { title, overflow } = titleFromLine(lines[first])
  const text = tidy((overflow ? lines.slice(first) : lines.slice(first + 1)).join('\n'))
  let unsorted = findUnsorted(model)
  if (!unsorted) {
    unsorted = createSection(UNSORTED)
    model.sections.unshift(unsorted)
  }
  const thought = createSection(title, text, today)
  unsorted.children.unshift(thought)
  return thought
}

export function renameSection(model, id, title, today) {
  const entry = locate(model, id)
  const clean = cleanTitle(title)
  if (!entry || !clean) return false
  if (clean !== entry.section.title) {
    entry.section.title = clean
    entry.section.edited = today
  }
  return true
}

export function setSectionText(model, id, text, today) {
  const entry = locate(model, id)
  if (!entry || entry.section.text === text) return
  entry.section.text = text
  entry.section.edited = today
}

/** Ticks or unticks the nth checklist item in a section's text ('intro' for the introduction). */
export function toggleCheck(model, id, n, today) {
  if (id === 'intro') model.intro = toggleChecklist(model.intro, n)
  else {
    const entry = locate(model, id)
    if (entry) setSectionText(model, id, toggleChecklist(entry.section.text, n), today)
  }
}

export function deleteSection(model, id) {
  const entry = locate(model, id)
  if (entry) entry.list.splice(entry.index, 1)
}

/** Where a section could move: the top level, or any section it fits under within MAX_DEPTH. */
export function moveTargets(model, id) {
  const entry = locate(model, id)
  if (!entry) return []
  const levels = height(entry.section)
  const inside = new Set(walk({ sections: [entry.section] }).map((other) => other.section.id))
  const targets = []
  if (entry.parent && levels <= MAX_DEPTH) targets.push({ id: null, title: 'Top level', depth: 0 })
  for (const other of walk(model)) {
    if (inside.has(other.section.id) || other.section === entry.parent) continue
    if (other.depth + levels <= MAX_DEPTH) targets.push({ id: other.section.id, title: other.section.title, depth: other.depth })
  }
  return targets
}

/** Moves a section to the end of another (or the top level, with null). Returns false if it can't. */
export function moveSection(model, id, targetId) {
  if (!moveTargets(model, id).some((target) => target.id === targetId)) return false
  const entry = locate(model, id)
  entry.list.splice(entry.index, 1)
  ;(targetId === null ? model.sections : locate(model, targetId).section.children).push(entry.section)
  return true
}

/** Puts a section just before a sibling, or last among its siblings when `beforeId` is null. */
export function reorderSection(model, id, beforeId) {
  const entry = locate(model, id)
  if (!entry || beforeId === id) return
  entry.list.splice(entry.index, 1)
  const index = beforeId === null ? -1 : entry.list.findIndex((section) => section.id === beforeId)
  entry.list.splice(index === -1 ? entry.list.length : index, 0, entry.section)
}

/** Moves a section one place up (-1) or down (1) among its siblings. Returns false at either end. */
export function moveSectionByOne(model, id, step) {
  const entry = locate(model, id)
  const target = entry ? entry.index + step : -1
  if (!entry || target < 0 || target >= entry.list.length) return false
  entry.list.splice(entry.index, 1)
  entry.list.splice(target, 0, entry.section)
  return true
}

/** Sections whose name or text contains `query`: name matches first, each with a snippet. */
export function searchNotebook(model, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const results = []
  for (const { section } of walk(model)) {
    const inTitle = section.title.toLowerCase().includes(needle)
    const at = section.text.toLowerCase().indexOf(needle)
    if (!inTitle && at === -1) continue
    const flat = (from, to) => section.text.slice(Math.max(0, from), to).replace(/\s+/g, ' ').trim()
    const snippet =
      at === -1
        ? flat(0, 90)
        : `${at > 40 ? '…' : ''}${flat(at - 40, at + needle.length + 60)}${at + needle.length + 60 < section.text.length ? '…' : ''}`
    results.push({
      id: section.id,
      title: section.title,
      path: pathTo(model, section.id).slice(0, -1).map((parent) => parent.title),
      inTitle,
      snippet,
    })
  }
  return [...results.filter((result) => result.inTitle), ...results.filter((result) => !result.inTitle)]
}

/** "12 sections · edited Oct 23" for the Standard Notes note list. */
export function previewNotebook(model, today) {
  const all = walk(model).map((entry) => entry.section)
  if (all.length === 0) return model.intro ? 'No sections yet' : 'Empty notebook'
  const latest = all.reduce((best, section) => (section.edited && section.edited > (best ?? '') ? section.edited : best), null)
  const count = `${all.length} ${all.length === 1 ? 'section' : 'sections'}`
  return latest ? `${count} · edited ${shortDate(latest, today)}` : count
}
