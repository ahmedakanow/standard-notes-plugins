// Pure Notebook logic: no DOM, so it can be tested in Node. A Notebook note is one topic
// organized like folders and files, written as Markdown headings. Sections are the
// folders: they hold sections of their own and entries. Entries are the files: a name
// and, if you like, some text. An entry's heading is followed by a hidden line that marks
// it as one and records when it was last edited.
//
//   ## Sleep
//   <!-- edited 2026-10-24 -->
//
//   ### Morning routine
//   <!-- entry 2026-10-24 -->
//   Wake at 7, no phone for the first hour.
//
//   ## Ask Sam which sleep app he uses
//   <!-- entry 2026-10-23 -->
//
// Each section's sections come first, then its entries. `##` is the top level, and
// sections go four levels deep (`#####`) so their entries fit in `######`. In an entry's
// text, lines that would read as headings are escaped (`\## …`) so they stay text.
//
// Before entries had names, text sat straight under a section's heading, split by
// `<!-- entry DATE -->` lines, and sections went five levels deep. Reading such a note
// turns that text into entries named after their first lines (keeping the whole text)
// and fifth-level sections into entries, and marks the model `upgraded` so it's saved.

import { isIsoDate, shortDate } from './dates.js'
import { plainPreview, toggleChecklist } from './markdown.js'

export const MAX_DEPTH = 4
const TITLE_LENGTH = 80

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{2,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const EDITED = /^<!--\s*edited\s+(\d{4}-\d{2}-\d{2})\s*-->\s*$/
const ENTRY = /^<!--\s*entry(?:\s+(\d{4}-\d{2}-\d{2}))?\s*-->\s*$/

let nextId = 1 // sections and entries share one id space

const tidy = (text) => text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
const dateIn = (match) => (match?.[1] && isIsoDate(match[1]) ? match[1] : null)

export function createSection(title, edited = null) {
  return { id: nextId++, title, edited, children: [], entries: [] }
}

export function createEntry(title, edited = null, text = '') {
  return { id: nextId++, title, edited, text }
}

export function cleanTitle(title) {
  return String(title)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/\s+#+$/, '')
    .trim()
}

/** A name from the first line of some text, shortened at a word if it's long. */
function titleFrom(text) {
  const title = cleanTitle(plainPreview(text, Infinity)) || 'Untitled'
  if (title.length <= TITLE_LENGTH) return title
  const cut = title.slice(0, TITLE_LENGTH)
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : TITLE_LENGTH).trimEnd()}…`
}

/** Old-style text, split at `<!-- entry DATE -->` lines outside code blocks: [{ text, date }]. */
function piecesOf(lines) {
  const pieces = []
  let current = { date: null, lines: [] }
  let inFence = false
  const close = () => {
    const text = tidy(current.lines.join('\n'))
    if (text) pieces.push({ text, date: current.date })
  }
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence
    const marker = !inFence && ENTRY.exec(line)
    if (marker) {
      close()
      current = { date: dateIn(marker), lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  close()
  return pieces
}

export function parseNotebook(body) {
  const model = { sections: [], entries: [], upgraded: false }
  const loose = new Map([[model, []]]) // text outside any entry, by where it sits: old style
  const texts = new Map() // each entry's lines
  const stack = [] // stack[n] is the open section at depth n + 1
  const all = body.replace(/\r\n?/g, '\n').split('\n')
  let lines = loose.get(model)
  let inFence = false

  for (let i = 0; i < all.length; i++) {
    const line = all[i]
    if (FENCE.test(line)) inFence = !inFence
    const heading = !inFence && HEADING.exec(line)
    if (!heading) {
      lines.push(inFence ? line : line.replace(/^\\(?=#{2,6}[ \t])/, '')) // see escapeHeadings
      continue
    }
    // Levels can't be skipped: a `####` straight under a `##` is one level down.
    const depth = Math.min(heading[1].length - 1, stack.length + 1)
    stack.length = depth - 1
    const parent = stack.at(-1) ?? model
    const title = cleanTitle(heading[2]) || 'Untitled'
    const entryMark = ENTRY.exec(all[i + 1] ?? '')
    const editedMark = EDITED.exec(all[i + 1] ?? '')
    if (entryMark || editedMark) i++
    if (entryMark || depth > MAX_DEPTH) {
      if (!entryMark) model.upgraded = true // a section too deep to hold entries becomes one
      const entry = createEntry(title, dateIn(entryMark ?? editedMark))
      parent.entries.push(entry)
      texts.set(entry, (lines = []))
    } else {
      const section = createSection(title, dateIn(editedMark))
      ;(parent === model ? model.sections : parent.children).push(section)
      stack.push(section)
      loose.set(section, (lines = []))
    }
  }

  for (const [entry, entryLines] of texts) {
    entry.text = piecesOf(entryLines)
      .map((piece) => piece.text)
      .join('\n\n')
  }
  for (const [place, placeLines] of loose) {
    const pieces = piecesOf(placeLines)
    if (pieces.length === 0) continue
    model.upgraded = true
    place.entries.unshift(
      ...pieces.map((piece) => createEntry(titleFrom(piece.text), piece.date ?? place.edited ?? null, piece.text)),
    )
  }
  return model
}

/** True once after reading a note in an older form, so it gets saved in the new one. */
export function takeUpgraded(model) {
  const { upgraded } = model
  model.upgraded = false
  return upgraded
}

/** Escapes lines in an entry's text that would otherwise be read back as headings. */
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
  const writeEntry = (entry, depth) => {
    const lines = [`${'#'.repeat(depth + 1)} ${entry.title}`, entry.edited ? `<!-- entry ${entry.edited} -->` : '<!-- entry -->']
    if (entry.text) lines.push(escapeHeadings(entry.text))
    blocks.push(lines.join('\n'))
  }
  const writeSection = (section, depth) => {
    const lines = [`${'#'.repeat(depth + 1)} ${section.title}`]
    if (section.edited) lines.push(`<!-- edited ${section.edited} -->`)
    blocks.push(lines.join('\n'))
    for (const child of section.children) writeSection(child, depth + 1)
    for (const entry of section.entries) writeEntry(entry, depth + 1)
  }
  for (const section of model.sections) writeSection(section, 1)
  for (const entry of model.entries) writeEntry(entry, 1)
  return { body: blocks.join('\n\n'), meta: {} }
}

/** Every section in reading order, with where it sits: { section, parent, list, index, depth }. */
export function walk(model) {
  const found = []
  const visit = (list, parent, depth) =>
    list.forEach((section, index) => {
      found.push({ section, parent, list, index, depth })
      visit(section.children, section, depth + 1)
    })
  visit(model.sections, null, 1)
  return found
}

export const locate = (model, id) => walk(model).find((place) => place.section.id === id) ?? null

/** The entries of a section, or of the notebook itself for null. */
const entriesOf = (model, section) => (section ? section.entries : model.entries)

/** Marks a section edited. The notebook itself has no date of its own. */
function touch(section, today) {
  if (section) section.edited = today
}

/** Where an entry is: { section (null on the front page), entry, index, depth (of the section) }. */
export function locateEntry(model, id) {
  for (const { section, depth } of [{ section: null, depth: 0 }, ...walk(model)]) {
    const entries = entriesOf(model, section)
    const index = entries.findIndex((entry) => entry.id === id)
    if (index !== -1) return { section, entry: entries[index], index, depth }
  }
  return null
}

/** Where an entry can go by id: a section, or the front page for null. */
const holder = (model, sectionId) => (sectionId === null ? { section: null } : locate(model, sectionId))

/** The sections from the top level down to `id`, inclusive. */
export function pathTo(model, id) {
  const path = []
  let place = locate(model, id)
  while (place) {
    path.unshift(place.section)
    place = place.parent ? locate(model, place.parent.id) : null
  }
  return path
}

/** Levels a section takes up, counting itself. */
export const height = (section) => 1 + Math.max(0, ...section.children.map(height))

/** How many sections and entries are inside, at any depth. */
export const countInside = (section) =>
  section.entries.length + section.children.reduce((total, child) => total + 1 + countInside(child), 0)

/** Adds a named section at the end of `parentId` (null for the top level). */
export function addSection(model, parentId, name, today) {
  const parent = parentId === null ? null : locate(model, parentId)
  const title = cleanTitle(name)
  if ((parentId !== null && !parent) || !title || (parent?.depth ?? 0) >= MAX_DEPTH) return null
  const section = createSection(title, today)
  ;(parent ? parent.section.children : model.sections).push(section)
  return section
}

/** Adds a named, empty entry at the end of a section, or of the front page with null. */
export function addEntry(model, sectionId, name, today) {
  const target = holder(model, sectionId)
  const title = cleanTitle(name)
  if (!target || !title) return null
  const entry = createEntry(title, today)
  entriesOf(model, target.section).push(entry)
  touch(target.section, today)
  return entry
}

export function renameSection(model, id, name, today) {
  const place = locate(model, id)
  const title = cleanTitle(name)
  if (!place || !title) return false
  if (title !== place.section.title) {
    place.section.title = title
    place.section.edited = today
  }
  return true
}

/** Marks an entry and the section it's in edited. */
function touchEntry(found, today) {
  found.entry.edited = today
  touch(found.section, today)
}

export function renameEntry(model, id, name, today) {
  const found = locateEntry(model, id)
  const title = cleanTitle(name)
  if (!found || !title) return false
  if (title !== found.entry.title) {
    found.entry.title = title
    touchEntry(found, today)
  }
  return true
}

export function setEntryText(model, id, text, today) {
  const found = locateEntry(model, id)
  if (!found || found.entry.text === text) return
  found.entry.text = text
  touchEntry(found, today)
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

/** Puts an entry just before another where it is, or last when `beforeId` is null. */
export function reorderEntry(model, id, beforeId) {
  const found = locateEntry(model, id)
  if (!found || beforeId === id) return
  const entries = entriesOf(model, found.section)
  entries.splice(found.index, 1)
  const index = beforeId === null ? -1 : entries.findIndex((entry) => entry.id === beforeId)
  entries.splice(index === -1 ? entries.length : index, 0, found.entry)
}

/** Where an entry could move: the front page (id and title null) or any section, except where it is. */
export function entryTargets(model, id) {
  const found = locateEntry(model, id)
  if (!found) return []
  const sections = walk(model)
    .filter((other) => other.section !== found.section)
    .map((other) => ({ id: other.section.id, title: other.section.title, depth: other.depth }))
  return found.section ? [{ id: null, title: null, depth: 0 }, ...sections] : sections
}

/** Moves an entry to the end of another section, or of the front page with null. */
export function moveEntry(model, id, sectionId, today) {
  const found = locateEntry(model, id)
  const target = holder(model, sectionId)
  if (!found || !target || target.section === found.section) return false
  entriesOf(model, found.section).splice(found.index, 1)
  entriesOf(model, target.section).push(found.entry)
  touch(target.section, today)
  return true
}

/** Ticks or unticks the nth checklist item in an entry. */
export function toggleCheck(model, id, n, today) {
  const found = locateEntry(model, id)
  if (found) setEntryText(model, id, toggleChecklist(found.entry.text, n), today)
}

export function deleteSection(model, id) {
  const place = locate(model, id)
  if (place) place.list.splice(place.index, 1)
}

/**
 * Where a section could move: the top level (id and title null), or any section it fits
 * under within MAX_DEPTH.
 */
export function moveTargets(model, id) {
  const place = locate(model, id)
  if (!place) return []
  const levels = height(place.section)
  const inside = new Set(walk({ sections: [place.section] }).map((other) => other.section.id))
  const targets = []
  if (place.parent && levels <= MAX_DEPTH) targets.push({ id: null, title: null, depth: 0 })
  for (const other of walk(model)) {
    if (inside.has(other.section.id) || other.section === place.parent) continue
    if (other.depth + levels <= MAX_DEPTH) targets.push({ id: other.section.id, title: other.section.title, depth: other.depth })
  }
  return targets
}

/** Moves a section to the end of another (or the top level, with null). Returns false if it can't. */
export function moveSection(model, id, targetId) {
  if (!moveTargets(model, id).some((target) => target.id === targetId)) return false
  const place = locate(model, id)
  place.list.splice(place.index, 1)
  ;(targetId === null ? model.sections : locate(model, targetId).section.children).push(place.section)
  return true
}

/** Puts a section just before a sibling, or last among its siblings when `beforeId` is null. */
export function reorderSection(model, id, beforeId) {
  const place = locate(model, id)
  if (!place || beforeId === id) return
  place.list.splice(place.index, 1)
  const index = beforeId === null ? -1 : place.list.findIndex((section) => section.id === beforeId)
  place.list.splice(index === -1 ? place.list.length : index, 0, place.section)
}

/** Moves a section one place up (-1) or down (1) among its siblings. Returns false at either end. */
export function moveSectionByOne(model, id, step) {
  const place = locate(model, id)
  const target = place ? place.index + step : -1
  if (!place || target < 0 || target >= place.list.length) return false
  place.list.splice(place.index, 1)
  place.list.splice(target, 0, place.section)
  return true
}

/** Up to ~100 characters of `text` around a match at `at`, or its start if there's none. */
function snippet(text, at, length) {
  const flat = (from, to) => text.slice(Math.max(0, from), to).replace(/\s+/g, ' ').trim()
  if (at === -1) return flat(0, 90)
  return `${at > 40 ? '…' : ''}${flat(at - 40, at + length + 60)}${at + length + 60 < text.length ? '…' : ''}`
}

/**
 * Sections whose name contains `query`, and entries whose name or text does: name
 * matches first. Each is { kind: 'section' | 'entry', id, title, path (the section names
 * above it), inTitle, snippet }.
 */
export function searchNotebook(model, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const results = []
  for (const { section } of [{ section: null }, ...walk(model)]) {
    const path = section ? pathTo(model, section.id).map((above) => above.title) : []
    if (section?.title.toLowerCase().includes(needle)) {
      results.push({ kind: 'section', id: section.id, title: section.title, path: path.slice(0, -1), inTitle: true, snippet: '' })
    }
    for (const entry of entriesOf(model, section)) {
      const inTitle = entry.title.toLowerCase().includes(needle)
      const at = entry.text.toLowerCase().indexOf(needle)
      if (!inTitle && at === -1) continue
      results.push({ kind: 'entry', id: entry.id, title: entry.title, path, inTitle, snippet: snippet(entry.text, at, needle.length) })
    }
  }
  return [...results.filter((result) => result.inTitle), ...results.filter((result) => !result.inTitle)]
}

/** "2 sections · 5 entries · edited Oct 24" for the Standard Notes note list. */
export function previewNotebook(model, today) {
  const sections = walk(model).map((place) => place.section)
  const entries = [model, ...sections].flatMap((place) => place.entries)
  if (sections.length + entries.length === 0) return 'Empty notebook'
  const latest = [...sections, ...entries].reduce((best, item) => (item.edited && item.edited > (best ?? '') ? item.edited : best), null)
  return [
    sections.length > 0 && `${sections.length} ${sections.length === 1 ? 'section' : 'sections'}`,
    entries.length > 0 && `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`,
    latest && `edited ${shortDate(latest, today)}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
