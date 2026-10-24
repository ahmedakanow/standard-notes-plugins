import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DEPTH,
  addEntry,
  addSection,
  countInside,
  deleteSection,
  entryTargets,
  height,
  locate,
  locateEntry,
  moveEntry,
  moveEntryByOne,
  moveSection,
  moveSectionByOne,
  moveTargets,
  parseNotebook,
  pathTo,
  previewNotebook,
  removeEntry,
  renameEntry,
  renameSection,
  reorderEntry,
  reorderSection,
  searchNotebook,
  serializeNotebook,
  setEntryText,
  takeUpgraded,
  toggleCheck,
  walk,
} from '../src/notebook.js'

const TODAY = '2026-10-30'

const DOCUMENTED = [
  '## Health',
  '<!-- edited 2026-10-24 -->',
  '',
  '### Sleep',
  '<!-- edited 2026-10-24 -->',
  '',
  '#### Evening routine',
  '<!-- entry 2026-10-24 -->',
  '- [x] Blackout curtains',
  '',
  '### Doctor visit',
  '<!-- entry 2026-10-20 -->',
  'Keep a sleep diary for a month.',
  '',
  '## Ask Sam which sleep app he uses',
  '<!-- entry 2026-10-23 -->',
].join('\n')

const titles = (items) => items.map((item) => item.title)
const sections = (model) => walk(model).map((place) => place.section)
const find = (model, title) => sections(model).find((section) => section.title === title) ?? null
const entry = (model, title) =>
  [model, ...sections(model)].flatMap((place) => place.entries).find((item) => item.title === title) ?? null

test('reads sections and named entries, with their dates', () => {
  const model = parseNotebook(DOCUMENTED)
  assert.equal(model.upgraded, false)
  assert.deepEqual(titles(model.sections), ['Health'])
  const health = model.sections[0]
  assert.equal(health.edited, '2026-10-24')
  assert.deepEqual(titles(health.children), ['Sleep'])
  assert.deepEqual(
    health.children[0].entries.map((item) => [item.title, item.edited, item.text]),
    [['Evening routine', '2026-10-24', '- [x] Blackout curtains']],
  )
  assert.deepEqual(titles(health.entries), ['Doctor visit'])
  assert.deepEqual(
    model.entries.map((item) => [item.title, item.edited, item.text]),
    [['Ask Sam which sleep app he uses', '2026-10-23', '']],
  )
})

test('writes it back exactly', () => {
  assert.equal(serializeNotebook(parseNotebook(DOCUMENTED)).body, DOCUMENTED)
})

test('skipped heading levels become the next level down', () => {
  const model = parseNotebook('## A\n#### B\n###### C')
  assert.deepEqual(titles(model.sections[0].children), ['B'])
  assert.deepEqual(titles(model.sections[0].children[0].children), ['C'])
  assert.equal(serializeNotebook(model).body, '## A\n\n### B\n\n#### C')
})

test('headings and entry lines inside code blocks stay text', () => {
  const model = parseNotebook('## Shell\n<!-- entry -->\n```\n## not a section\n<!-- entry -->\n```')
  assert.deepEqual(model.sections, [])
  assert.equal(model.entries[0].text, '```\n## not a section\n<!-- entry -->\n```')
})

test('text that looks like a heading is escaped when saved and read back as text', () => {
  const model = parseNotebook('')
  const notes = addEntry(model, null, 'Notes', TODAY)
  setEntryText(model, notes.id, 'Before\n## Not a section\nAfter', TODAY)
  const body = serializeNotebook(model).body
  assert.match(body, /\n\\## Not a section\n/)
  const again = parseNotebook(body)
  assert.deepEqual(again.sections, [])
  assert.equal(again.entries[0].text, 'Before\n## Not a section\nAfter')
})

test('an older notebook: its text becomes entries named after their first lines, keeping all the text', () => {
  const model = parseNotebook(
    [
      'Everything about sleeping better.',
      '',
      '<!-- entry 2026-10-22 -->',
      'Ask Sam which sleep app he uses',
      '',
      '## Sleep',
      '<!-- edited 2026-10-20 -->',
      'Notes about **sleep**.',
      '',
      '<!-- entry 2026-10-21 -->',
      '- [ ] A later thought about naps',
      '',
      '### Morning routine',
      'Wake at 7, no phone for the first hour.',
      '',
      '#### Deeper',
      '##### Deeper still',
      '###### Deepest',
      '<!-- edited 2026-10-01 -->',
      'Five levels down',
      '',
      '<!-- entry 2026-10-02 -->',
      'Second piece',
    ].join('\n'),
  )
  const described = (place) => place.entries.map((item) => [item.title, item.edited, item.text])
  assert.deepEqual(described(model), [
    ['Everything about sleeping better.', null, 'Everything about sleeping better.'],
    ['Ask Sam which sleep app he uses', '2026-10-22', 'Ask Sam which sleep app he uses'],
  ])
  assert.deepEqual(described(find(model, 'Sleep')), [
    ['Notes about sleep.', '2026-10-20', 'Notes about **sleep**.'],
    ['A later thought about naps', '2026-10-21', '- [ ] A later thought about naps'],
  ])
  assert.deepEqual(described(find(model, 'Morning routine')), [
    ['Wake at 7, no phone for the first hour.', null, 'Wake at 7, no phone for the first hour.'],
  ])
  assert.deepEqual(described(find(model, 'Deeper still')), [['Deepest', '2026-10-01', 'Five levels down\n\nSecond piece']], 'a fifth-level section becomes an entry')
  assert.equal(takeUpgraded(model), true)
  assert.equal(takeUpgraded(model), false, 'only once')
  const again = parseNotebook(serializeNotebook(model).body)
  assert.equal(again.upgraded, false)
  assert.deepEqual(described(again), described(model))
})

test('adding sections and entries takes just a name; sections go four levels deep', () => {
  const model = parseNotebook('')
  const a = addSection(model, null, '  A  ', TODAY)
  assert.deepEqual([a.title, a.edited], ['A', TODAY])
  let parent = a
  for (let depth = 2; depth <= MAX_DEPTH; depth++) parent = addSection(model, parent.id, `Level ${depth}`, TODAY)
  assert.equal(locate(model, parent.id).depth, MAX_DEPTH)
  assert.equal(addSection(model, parent.id, 'Too deep', TODAY), null)
  parent.edited = null
  const note = addEntry(model, parent.id, 'Note', TODAY)
  assert.deepEqual([note.title, note.text, note.edited, parent.edited], ['Note', '', TODAY, TODAY])
  assert.equal(addSection(model, null, '   ', TODAY), null, 'nothing to add')
  assert.equal(addEntry(model, null, '', TODAY), null)
  assert.equal(height(a), MAX_DEPTH)
  assert.equal(countInside(a), MAX_DEPTH, 'three sections and the entry')
  const body = serializeNotebook(model).body
  assert.ok(body.endsWith(`##### Level 4\n<!-- edited ${TODAY} -->\n\n###### Note\n<!-- entry ${TODAY} -->`), body)
  const again = parseNotebook(body)
  assert.equal(again.upgraded, false)
  assert.equal(locateEntry(again, entry(again, 'Note').id).depth, MAX_DEPTH, 'the entry fits in the deepest section')
})

test('renaming, editing and removing entries mark them and their section edited', () => {
  const model = parseNotebook(DOCUMENTED)
  const health = find(model, 'Health')
  const doctor = entry(model, 'Doctor visit')
  assert.equal(renameEntry(model, doctor.id, '  Doctor, October  ', TODAY), true)
  assert.deepEqual([doctor.title, doctor.edited, health.edited], ['Doctor, October', TODAY, TODAY])
  assert.equal(renameEntry(model, doctor.id, '   ', TODAY), false)
  const routine = entry(model, 'Evening routine')
  setEntryText(model, routine.id, routine.text, TODAY)
  assert.equal(routine.edited, '2026-10-24', 'unchanged text')
  setEntryText(model, routine.id, '- [ ] Blackout curtains', TODAY)
  assert.deepEqual([routine.edited, find(model, 'Sleep').edited], [TODAY, TODAY])
  removeEntry(model, doctor.id, TODAY)
  assert.deepEqual(health.entries, [])
  const sleep = find(model, 'Sleep')
  assert.equal(renameSection(model, sleep.id, '  ## Rest  ', TODAY), true)
  assert.equal(sleep.title, 'Rest')
  assert.equal(renameSection(model, sleep.id, '   ', TODAY), false)
})

test('moving entries: within their list, to a section, and to the front page', () => {
  const model = parseNotebook(
    '## A\n<!-- edited 2026-10-01 -->\n\n### one\n<!-- entry -->\n\n### two\n<!-- entry -->\n\n## B\n<!-- edited 2026-10-01 -->\n\n## loose\n<!-- entry -->',
  )
  const a = find(model, 'A')
  const b = find(model, 'B')
  const [one, two] = a.entries
  assert.equal(moveEntryByOne(model, two.id, -1), true)
  assert.deepEqual(titles(a.entries), ['two', 'one'])
  assert.equal(moveEntryByOne(model, two.id, -1), false)
  reorderEntry(model, two.id, null)
  assert.deepEqual(titles(a.entries), ['one', 'two'])
  assert.deepEqual(
    entryTargets(model, one.id).map((target) => [target.id, target.title]),
    [
      [null, null],
      [b.id, 'B'],
    ],
    'the front page comes first',
  )
  assert.equal(moveEntry(model, one.id, b.id, TODAY), true)
  assert.deepEqual([titles(a.entries), titles(b.entries), b.edited], [['two'], ['one'], TODAY])
  assert.equal(moveEntry(model, two.id, null, TODAY), true)
  assert.deepEqual(titles(model.entries), ['loose', 'two'], 'at the end, like anywhere else')
  assert.deepEqual(locateEntry(model, two.id), { section: null, entry: two, index: 1, depth: 0 })
  assert.deepEqual(titles(entryTargets(model, two.id)), ['A', 'B'])
})

test('ticking checklist items in an entry, skipping ones in code blocks', () => {
  const model = parseNotebook('## List\n<!-- entry -->\n```\n- [ ] not a real item\n```\n- [ ] one\n- [x] two')
  const list = model.entries[0]
  toggleCheck(model, list.id, 0, TODAY)
  toggleCheck(model, list.id, 1, TODAY)
  assert.equal(list.text, '```\n- [ ] not a real item\n```\n- [x] one\n- [ ] two')
  assert.equal(list.edited, TODAY)
})

test('moving sections: never into itself, and only where it fits within four levels', () => {
  const model = parseNotebook('## A\n### A1\n#### A1a\n## B\n### B1\n#### B1a')
  const a = find(model, 'A')
  const targets = titles(moveTargets(model, a.id))
  assert.deepEqual(targets, ['B'], 'not into its own sections, and A is three levels deep, so B1 would be too deep')
  assert.deepEqual(moveTargets(model, find(model, 'A1').id)[0], { id: null, title: null, depth: 0 }, 'the top level first')
  assert.equal(moveSection(model, a.id, find(model, 'B1').id), false)
  assert.equal(moveSection(model, a.id, find(model, 'B').id), true)
  assert.deepEqual(titles(find(model, 'B').children), ['B1', 'A'])
  assert.deepEqual(titles(pathTo(model, find(model, 'A1a').id)), ['B', 'A', 'A1', 'A1a'])
  assert.equal(moveSection(model, find(model, 'A1').id, null), true, 'back to the top level')
  assert.deepEqual(titles(model.sections), ['B', 'A1'])
})

test('reordering sibling sections', () => {
  const model = parseNotebook('## A\n## B\n## C')
  const [a, b, c] = model.sections
  reorderSection(model, c.id, a.id)
  assert.deepEqual(titles(model.sections), ['C', 'A', 'B'])
  reorderSection(model, c.id, null)
  assert.deepEqual(titles(model.sections), ['A', 'B', 'C'])
  assert.equal(moveSectionByOne(model, b.id, -1), true)
  assert.deepEqual(titles(model.sections), ['B', 'A', 'C'])
  assert.equal(moveSectionByOne(model, b.id, -1), false)
})

test('deleting a section removes everything inside it', () => {
  const model = parseNotebook(DOCUMENTED)
  const routine = entry(model, 'Evening routine')
  assert.equal(countInside(find(model, 'Health')), 3)
  deleteSection(model, find(model, 'Health').id)
  assert.deepEqual(model.sections, [])
  assert.equal(locateEntry(model, routine.id), null)
  assert.deepEqual(titles(model.entries), ['Ask Sam which sleep app he uses'])
})

test('search: names first, then text, each with where it is', () => {
  const model = parseNotebook(DOCUMENTED)
  const results = searchNotebook(model, 'sleep')
  assert.deepEqual(
    results.map((result) => [result.kind, result.title, result.path, result.inTitle]),
    [
      ['entry', 'Ask Sam which sleep app he uses', [], true],
      ['section', 'Sleep', ['Health'], true],
      ['entry', 'Doctor visit', ['Health'], false],
    ],
  )
  assert.match(results[2].snippet, /sleep diary/)
  assert.equal(results[1].id, find(model, 'Sleep').id)
  assert.deepEqual(searchNotebook(model, '   '), [])
})

test('the note-list preview counts sections and entries and shows the latest edit', () => {
  assert.equal(previewNotebook(parseNotebook(DOCUMENTED), TODAY), '2 sections · 3 entries · edited Oct 24')
  assert.equal(previewNotebook(parseNotebook(''), TODAY), 'Empty notebook')
  assert.equal(previewNotebook(parseNotebook('## Only'), TODAY), '1 section')
  assert.equal(previewNotebook(parseNotebook('## Idea\n<!-- entry -->'), TODAY), '1 entry')
})
