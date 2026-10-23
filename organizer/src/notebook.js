// Pure Notebook logic: no DOM, so it can be tested in Node. A Notebook note is one topic
// as a tree of sections, written as Markdown headings. The notebook itself and each section
// hold entries: unnamed pieces of text, each starting with a hidden line that records when
// it was added.
//
//   Anything before the first heading is the notebook's own entries.
//
//   <!-- entry 2026-10-23 -->
//   A thought added on the front page.
//
//   ## Sleep
//   <!-- edited 2026-10-23 -->
//   Text from before entries existed is the first entry, with no date.
//
//   <!-- entry 2026-10-23 -->
//   A later entry.
//
//   ### Morning routine
//   <!-- entry 2026-10-20 -->
//   Wake at 7…
//
// `##` is the top level and `######` the fifth. The hidden `edited` line records when a
// section's name or entries last changed. Inside entries, lines that would read as
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
const ENTRY = /^<!--\s*entry(?:\s+(\d{4}-\d{2}-\d{2}))?\s*-->\s*$/

let nextId = 1 // sections and entries share one id space

const tidy = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')

export function createSection(title, edited = null) {
  return { id: nextId++, title, edited, entries: [], children: [] }
}

export function createEntry(text, added = null) {
  return { id: nextId++, added, text }
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

/** Splits a section's lines into entries at `<!-- entry … -->` lines (outside code blocks). */
function entriesFrom(lines) {
  const entries = []
  let current = { added: null, lines: [] }
  let inFence = false
  const close = () => {
    const text = tidy(current.lines.join('\n'))
    if (text) entries.push(createEntry(text, current.added))
  }
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence
    const marker = !inFence && ENTRY.exec(line)
    if (marker) {
      close()
      current = { added: marker[1] && isIsoDate(marker[1]) ? marker[1] : null, lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  close()
  return entries
}

export function parseNotebook(body) {
  const front = [] // lines before the first heading
  const sections = []
  const stack = [] // stack[n] is the open section at depth n + 1
  const lines = new Map()
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
      lines.set(current, [])
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
    if (current) lines.get(current).push(text)
    else front.push(text)
  }
  for (const [section, sectionLines] of lines) section.entries = entriesFrom(sectionLines)
  return { entries: entriesFrom(front), sections }
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

function entryLines(entries) {
  const lines = []
  entries.forEach((entry, index) => {
    // The first entry can go without a marker; after that, one is needed to keep them apart.
    if (entry.added) lines.push(`<!-- entry ${entry.added} -->`)
    else if (index > 0) lines.push('<!-- entry -->')
    lines.push(escapeHeadings(entry.text))
    if (index < entries.length - 1) lines.push('')
  })
  return lines
}

export function serializeNotebook(model) {
  const blocks = []
  if (model.entries.length > 0) blocks.push(entryLines(model.entries).join('\n'))
  const write = (section, depth) => {
    const lines = [`${'#'.repeat(depth + 1)} ${section.title}`]
    if (section.edited) lines.push(`<!-- edited ${section.edited} -->`)
    lines.push(...entryLines(section.entries))
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

/** The entries of a section, or of the notebook itself for null. */
const entriesOf = (model, section) => (section ? section.entries : model.entries)

/** Marks a section edited. The notebook itself has no date of its own. */
function touch(section, today) {
  if (section) section.edited = today
}

/** Where an entry is: { section (null on the notebook itself), entry, index, depth }. */
export function locateEntry(model, id) {
  for (const { section, depth } of [{ section: null, depth: 0 }, ...walk(model)]) {
    const entries = entriesOf(model, section)
    const index = entries.findIndex((entry) => entry.id === id)
    if (index !== -1) return { section, entry: entries[index], index, depth }
  }
  return null
}

/** Where an entry can go by id: a section, or the notebook itself for null. */
const holder = (model, sectionId) => (sectionId === null ? { section: null } : locate(model, sectionId))

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

/** All of a section's text, for search and previews. */
export const sectionText = (section) => section.entries.map((entry) => entry.text).join('\n\n')

/**
 * Turns typed or pasted text into a section: the first line is the name and the rest its
 * first entry. Headings in the rest become sub-sections; any deeper than `room` levels
 * below it become bold lines instead.
 */
export function sectionFromText(input, today, room = MAX_DEPTH - 1) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((line) => line.trim())
  if (first === -1) return null
  const { title, overflow } = titleFromLine(lines[first])
  const section = createSection(title, today)
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
      const child = createSection(cleanTitle(heading[2]) || 'Untitled', today)
      stack.at(-1).children.push(child)
      stack.push(child)
      texts.set(child, [])
      continue
    }
    texts.get(stack.at(-1)).push(line)
  }
  for (const [part, partLines] of texts) {
    const text = tidy(partLines.join('\n'))
    if (text) part.entries.push(createEntry(text, today))
  }
  return section
}

/** Pasted or typed text as one entry: any headings become bold lines. */
function entryText(input) {
  let inFence = false
  return tidy(
    String(input)
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => {
        if (FENCE.test(line)) inFence = !inFence
        const heading = !inFence && ANY_HEADING.exec(line)
        return heading ? `**${cleanTitle(heading[2])}**` : line
      })
      .join('\n'),
  )
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

/** Adds an entry at the end of a section, or of the notebook itself with null. */
export function addEntry(model, sectionId, input, today) {
  const target = holder(model, sectionId)
  const text = entryText(input)
  if (!target || !text) return null
  const entry = createEntry(text, today)
  entriesOf(model, target.section).push(entry)
  touch(target.section, today)
  return entry
}

/**
 * Quick thoughts used to go into an Unsorted section; now they're the notebook's own
 * entries. Moves everything in Unsorted there, oldest first, and removes it. Thoughts
 * saved as small sections become entries, unless they have sections inside, which move
 * to the top level instead. Returns whether there was an Unsorted.
 */
export function mergeUnsorted(model) {
  const index = model.sections.findIndex((section) => section.title.toLowerCase() === UNSORTED.toLowerCase())
  if (index === -1) return false
  const [unsorted] = model.sections.splice(index, 1)
  const thoughts = []
  // Unsorted kept the newest at the top.
  for (const child of [...unsorted.children].reverse()) {
    if (child.children.length > 0) model.sections.push(child)
    else thoughts.push(createEntry([child.title, sectionText(child)].filter(Boolean).join('\n\n'), child.edited))
  }
  thoughts.push(...[...unsorted.entries].reverse())
  thoughts.sort((a, b) => (a.added ?? '').localeCompare(b.added ?? ''))
  model.entries.push(...thoughts)
  return true
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

export function setEntryText(model, id, text, today) {
  const found = locateEntry(model, id)
  if (!found || found.entry.text === text) return
  found.entry.text = text
  touch(found.section, today)
}

export function removeEntry(model, id, today) {
  const found = locateEntry(model, id)
  if (!found) return
  entriesOf(model, found.section).splice(found.index, 1)
  touch(found.section, today)
}

/** Moves an entry one place up (-1) or down (1) where it is. Returns false at either end. */
export function moveEntryByOne(model, id, step) {
  const found = locateEntry(model, id)
  if (!found) return false
  const entries = entriesOf(model, found.section)
  const target = found.index + step
  if (target < 0 || target >= entries.length) return false
  entries.splice(found.index, 1)
  entries.splice(target, 0, found.entry)
  return true
}

/** Where an entry could move: the notebook itself (id and title null) or any section, except where it is. */
export function entryTargets(model, id) {
  const found = locateEntry(model, id)
  if (!found) return []
  const sections = walk(model)
    .filter((other) => other.section !== found.section)
    .map((other) => ({ id: other.section.id, title: other.section.title, depth: other.depth }))
  return found.section ? [{ id: null, title: null, depth: 0 }, ...sections] : sections
}

/** Moves an entry to the end of another section, or of the notebook itself with null. */
export function moveEntry(model, id, sectionId, today) {
  const found = locateEntry(model, id)
  const target = holder(model, sectionId)
  if (!found || !target || target.section === found.section) return false
  entriesOf(model, found.section).splice(found.index, 1)
  entriesOf(model, target.section).push(found.entry)
  touch(target.section, today)
  return true
}

/**
 * Turns an entry into a section inside the one it's in (at the top level, from the
 * notebook itself): its first line becomes the name and the rest stays as its text.
 */
export function entryToSection(model, id, today) {
  const found = locateEntry(model, id)
  if (!found || found.depth >= MAX_DEPTH) return null
  const lines = found.entry.text.split('\n')
  const { title, overflow } = titleFromLine(lines[0])
  const section = createSection(title, today)
  const rest = tidy((overflow ? lines : lines.slice(1)).join('\n'))
  if (rest) section.entries.push(createEntry(rest, found.entry.added))
  entriesOf(model, found.section).splice(found.index, 1)
  touch(found.section, today)
  ;(found.section ? found.section.children : model.sections).push(section)
  return section
}

/** Ticks or unticks the nth checklist item in an entry. */
export function toggleCheck(model, id, n, today) {
  const found = locateEntry(model, id)
  if (found) setEntryText(model, id, toggleChecklist(found.entry.text, n), today)
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

/**
 * Sections whose name or entries contain `query`, and the notebook itself (id and title
 * null) if its entries do: name matches first, each with a snippet and the first matching
 * entry (`entryId`), so the view can scroll to it.
 */
export function searchNotebook(model, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const results = []
  for (const { section } of [{ section: null }, ...walk(model)]) {
    const entries = entriesOf(model, section)
    const inTitle = Boolean(section?.title.toLowerCase().includes(needle))
    const match = entries.find((entry) => entry.text.toLowerCase().includes(needle))
    if (!inTitle && !match) continue
    const text = (match ?? entries[0])?.text ?? ''
    const at = match ? text.toLowerCase().indexOf(needle) : -1
    const flat = (from, to) => text.slice(Math.max(0, from), to).replace(/\s+/g, ' ').trim()
    const snippet =
      at === -1
        ? flat(0, 90)
        : `${at > 40 ? '…' : ''}${flat(at - 40, at + needle.length + 60)}${at + needle.length + 60 < text.length ? '…' : ''}`
    results.push({
      id: section?.id ?? null,
      entryId: match?.id ?? null,
      title: section?.title ?? null,
      path: section ? pathTo(model, section.id).slice(0, -1).map((parent) => parent.title) : [],
      inTitle,
      snippet,
    })
  }
  return [...results.filter((result) => result.inTitle), ...results.filter((result) => !result.inTitle)]
}

/** "12 sections · edited Oct 23" for the Standard Notes note list. */
export function previewNotebook(model, today) {
  const all = walk(model).map((entry) => entry.section)
  if (all.length === 0) return model.entries.length > 0 ? 'No sections yet' : 'Empty notebook'
  // Something added on the front page counts as an edit too.
  const dates = [...all.map((section) => section.edited), ...model.entries.map((entry) => entry.added)]
  const latest = dates.reduce((best, date) => (date && date > (best ?? '') ? date : best), null)
  const count = `${all.length} ${all.length === 1 ? 'section' : 'sections'}`
  return latest ? `${count} · edited ${shortDate(latest, today)}` : count
}
