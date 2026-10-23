import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DEPTH,
  addEntry,
  addSection,
  countInside,
  deleteSection,
  entryTargets,
  entryToSection,
  height,
  locate,
  locateEntry,
  mergeUnsorted,
  moveEntry,
  moveEntryByOne,
  moveSection,
  moveSectionByOne,
  moveTargets,
  parseNotebook,
  pathTo,
  previewNotebook,
  removeEntry,
  renameSection,
  reorderSection,
  searchNotebook,
  sectionFromText,
  sectionText,
  serializeNotebook,
  setEntryText,
  toggleCheck,
} from '../src/notebook.js'

const TODAY = '2026-10-23'

const DOCUMENTED = [
  'Everything about sleeping better.',
  '',
  '<!-- entry 2026-10-22 -->',
  'Ask Sam which sleep app he uses',
  '',
  '## Sleep',
  '<!-- edited 2026-10-20 -->',
  'Notes about sleep.',
  '',
  '<!-- entry 2026-10-21 -->',
  'A later thought about naps.',
  '',
  '### Morning routine',
  'Wake at 7, no phone for the first hour.',
  '',
  '### What the doctor said',
  '<!-- edited 2026-10-01 -->',
  '<!-- entry 2026-10-01 -->',
  '- Magnesium before bed',
  '- [ ] Book a follow-up',
  '',
  '## Exercise',
].join('\n')

const titles = (sections) => sections.map((section) => section.title)
const texts = (section) => section.entries.map((entry) => entry.text)
function find(model, title) {
  const stack = [...model.sections]
  while (stack.length) {
    const section = stack.shift()
    if (section.title === title) return section
    stack.push(...section.children)
  }
  return null
}

test("reads the documented format: the notebook's own entries, nested sections, entries and dates", () => {
  const model = parseNotebook(DOCUMENTED)
  assert.deepEqual(
    model.entries.map((entry) => [entry.text, entry.added]),
    [
      ['Everything about sleeping better.', null],
      ['Ask Sam which sleep app he uses', '2026-10-22'],
    ],
  )
  assert.deepEqual(titles(model.sections), ['Sleep', 'Exercise'])
  const sleep = model.sections[0]
  assert.equal(sleep.edited, '2026-10-20')
  assert.deepEqual(
    sleep.entries.map((entry) => [entry.text, entry.added]),
    [
      ['Notes about sleep.', null],
      ['A later thought about naps.', '2026-10-21'],
    ],
  )
  assert.deepEqual(titles(sleep.children), ['Morning routine', 'What the doctor said'])
  assert.deepEqual(texts(sleep.children[1]), ['- Magnesium before bed\n- [ ] Book a follow-up'])
  assert.deepEqual(find(model, 'Exercise').entries, [])
})

test('writes it back exactly', () => {
  assert.equal(serializeNotebook(parseNotebook(DOCUMENTED)).body, DOCUMENTED)
})

test('an undated entry that is no longer first keeps a marker, so entries stay apart', () => {
  const model = parseNotebook(DOCUMENTED)
  const sleep = find(model, 'Sleep')
  moveEntryByOne(model, sleep.entries[0].id, 1)
  const body = serializeNotebook(model).body
  assert.match(body, /<!-- entry 2026-10-21 -->\nA later thought about naps\.\n\n<!-- entry -->\nNotes about sleep\./)
  assert.deepEqual(texts(find(parseNotebook(body), 'Sleep')), ['A later thought about naps.', 'Notes about sleep.'])
})

test('skipped heading levels become the next level down', () => {
  const model = parseNotebook('## A\n#### B\n###### C')
  assert.deepEqual(titles(model.sections[0].children), ['B'])
  assert.deepEqual(titles(model.sections[0].children[0].children), ['C'])
  assert.equal(serializeNotebook(model).body, '## A\n\n### B\n\n#### C')
})

test('headings and entry lines inside code blocks stay text', () => {
  const model = parseNotebook('## Shell\n```\n## not a section\n<!-- entry -->\n```')
  assert.equal(model.sections[0].children.length, 0)
  assert.deepEqual(texts(model.sections[0]), ['```\n## not a section\n<!-- entry -->\n```'])
})

test('text that looks like a heading is escaped when saved and read back as text', () => {
  const model = parseNotebook('## Notes')
  addEntry(model, model.sections[0].id, 'Before', TODAY)
  setEntryText(model, model.sections[0].entries[0].id, 'Before\n## Not a section\nAfter', TODAY)
  const body = serializeNotebook(model).body
  assert.match(body, /\n\\## Not a section\n/)
  const again = parseNotebook(body)
  assert.equal(again.sections[0].children.length, 0)
  assert.deepEqual(texts(again.sections[0]), ['Before\n## Not a section\nAfter'])
})

test('a pasted section: first line is the name, its headings become sub-sections, all dated', () => {
  const pasted = '# Sleep\nI sleep badly.\n\n# Tips\nNo coffee after 2pm.\n## Supplements\nMagnesium.'
  const section = sectionFromText(pasted, TODAY)
  assert.deepEqual([section.title, section.edited], ['Sleep', TODAY])
  assert.deepEqual(
    section.entries.map((entry) => [entry.text, entry.added]),
    [['I sleep badly.', TODAY]],
  )
  assert.deepEqual(titles(section.children), ['Tips'])
  assert.deepEqual(texts(section.children[0]), ['No coffee after 2pm.'])
  assert.deepEqual(titles(section.children[0].children), ['Supplements'])
})

test('pasted headings deeper than the room left become bold lines', () => {
  const section = sectionFromText('Sleep\n# Tips\nNo coffee\n## Supplements\nMagnesium', TODAY, 1)
  assert.deepEqual(titles(section.children), ['Tips'])
  assert.deepEqual(texts(section.children[0]), ['No coffee\n**Supplements**\nMagnesium'])
})

test('a long first line is shortened for the name and kept in the text', () => {
  const line = 'This is a very long first line of a pasted note that keeps going well past the point where a name should stop'
  const section = sectionFromText(`${line}\nmore`, TODAY)
  assert.ok(section.title.endsWith('…'))
  assert.ok(section.title.length <= 81)
  assert.deepEqual(texts(section), [`${line}\nmore`])
})

test('adding sections, and the five-level limit', () => {
  const model = parseNotebook('')
  const a = addSection(model, null, 'A', TODAY)
  let parent = a
  for (let depth = 2; depth <= MAX_DEPTH; depth++) parent = addSection(model, parent.id, `Level ${depth}`, TODAY)
  assert.equal(locate(model, parent.id).depth, MAX_DEPTH)
  assert.equal(addSection(model, parent.id, 'Too deep', TODAY), null)
  assert.equal(addSection(model, null, '   ', TODAY), null, 'nothing to add')
  assert.equal(height(a), MAX_DEPTH)
  assert.equal(countInside(a), MAX_DEPTH - 1)
})

test('adding an entry: at the end, headings kept as bold lines, the section marked edited', () => {
  const model = parseNotebook('## Sleep\n<!-- edited 2026-10-01 -->\nFirst')
  const sleep = model.sections[0]
  const entry = addEntry(model, sleep.id, '# Article about light\nMorning light helps.', TODAY)
  assert.deepEqual(texts(sleep), ['First', '**Article about light**\nMorning light helps.'])
  assert.deepEqual([entry.added, sleep.edited], [TODAY, TODAY])
  assert.equal(addEntry(model, sleep.id, '  \n ', TODAY), null)
  assert.match(serializeNotebook(model).body, /First\n\n<!-- entry 2026-10-23 -->\n\*\*Article about light\*\*/)
})

test('thoughts are entries on the notebook itself, written before the first section', () => {
  const model = parseNotebook('## Sleep')
  addEntry(model, null, 'Try magnesium', TODAY)
  addEntry(model, null, 'Ask Sam about his app\nHe mentioned it on Friday', TODAY)
  assert.deepEqual(texts(model), ['Try magnesium', 'Ask Sam about his app\nHe mentioned it on Friday'])
  assert.equal(model.sections[0].edited, null, 'no section changed')
  assert.equal(addEntry(model, null, '  ', TODAY), null)
  const body = serializeNotebook(model).body
  assert.equal(
    body,
    `<!-- entry ${TODAY} -->\nTry magnesium\n\n<!-- entry ${TODAY} -->\nAsk Sam about his app\nHe mentioned it on Friday\n\n## Sleep`,
  )
  assert.deepEqual(texts(parseNotebook(body)), texts(model))
})

test('an Unsorted section from an older version moves onto the notebook itself, oldest first', () => {
  const model = parseNotebook(
    [
      'About sleep.',
      '',
      '## Unsorted',
      '<!-- edited 2026-10-22 -->',
      '<!-- entry 2026-10-22 -->',
      'Newer thought',
      '',
      '<!-- entry 2026-10-21 -->',
      'Older thought',
      '',
      '### Thought saved as a section',
      '<!-- edited 2026-10-20 -->',
      'With some text',
      '',
      '### A thought that grew',
      '<!-- edited 2026-10-19 -->',
      '#### Its own section',
      '',
      '## Sleep',
    ].join('\n'),
  )
  assert.equal(mergeUnsorted(model), true)
  assert.deepEqual(
    model.entries.map((entry) => [entry.text, entry.added]),
    [
      ['About sleep.', null],
      ['Thought saved as a section\n\nWith some text', '2026-10-20'],
      ['Older thought', '2026-10-21'],
      ['Newer thought', '2026-10-22'],
    ],
  )
  assert.deepEqual(titles(model.sections), ['Sleep', 'A thought that grew'], 'one with sections inside moves to the top level')
  assert.deepEqual(titles(model.sections[1].children), ['Its own section'])
  assert.equal(mergeUnsorted(model), false, 'nothing left to merge')
})

test('editing and removing entries update the section, renaming too', () => {
  const model = parseNotebook(DOCUMENTED)
  const routine = find(model, 'Morning routine')
  setEntryText(model, routine.entries[0].id, routine.entries[0].text, TODAY)
  assert.equal(routine.edited, null, 'unchanged text')
  setEntryText(model, routine.entries[0].id, 'Wake at 6', TODAY)
  assert.equal(routine.edited, TODAY)
  const sleep = find(model, 'Sleep')
  removeEntry(model, sleep.entries[1].id, TODAY)
  assert.deepEqual([texts(sleep), sleep.edited], [['Notes about sleep.'], TODAY])
  const exercise = find(model, 'Exercise')
  assert.equal(renameSection(model, exercise.id, '  ## Training  ', TODAY), true)
  assert.deepEqual([exercise.title, exercise.edited], ['Training', TODAY])
  assert.equal(renameSection(model, exercise.id, '   ', TODAY), false)
})

test('moving entries: up and down, to another section, and to the notebook itself', () => {
  const model = parseNotebook('loose\n\n## A\none\n<!-- entry -->\ntwo\n\n## B')
  const a = find(model, 'A')
  const [one, two] = a.entries
  assert.equal(moveEntryByOne(model, two.id, -1), true)
  assert.deepEqual(texts(a), ['two', 'one'])
  assert.equal(moveEntryByOne(model, two.id, -1), false)
  assert.deepEqual(
    entryTargets(model, one.id).map((target) => [target.id, target.title]),
    [
      [null, null],
      [find(model, 'B').id, 'B'],
    ],
    'the notebook itself comes first',
  )
  assert.equal(moveEntry(model, one.id, find(model, 'B').id, TODAY), true)
  assert.deepEqual([texts(a), texts(find(model, 'B'))], [['two'], ['one']])
  assert.equal(find(model, 'B').edited, TODAY)
  assert.equal(moveEntry(model, two.id, null, TODAY), true)
  assert.deepEqual(texts(model), ['loose', 'two'], 'at the end, like anywhere else')
  assert.deepEqual(locateEntry(model, two.id), { section: null, entry: two, index: 1, depth: 0 })
  assert.deepEqual(
    entryTargets(model, two.id).map((target) => target.title),
    ['A', 'B'],
  )
  assert.equal(moveEntryByOne(model, two.id, -1), true)
  assert.deepEqual(texts(model), ['two', 'loose'])
})

test('an entry can become a section inside its own, or at the top level from the notebook itself', () => {
  const model = parseNotebook('<!-- entry 2026-10-01 -->\nRead about light\nThe article on mornings\n\n## Sleep\nNaps\nShort ones only')
  const sleep = find(model, 'Sleep')
  const naps = entryToSection(model, sleep.entries[0].id, TODAY)
  assert.deepEqual([naps.title, texts(naps), sleep.entries.length], ['Naps', ['Short ones only'], 0])
  assert.equal(sleep.children[0], naps)
  const light = entryToSection(model, model.entries[0].id, TODAY)
  assert.deepEqual(titles(model.sections), ['Sleep', 'Read about light'])
  assert.deepEqual(model.entries, [])
  assert.equal(light.entries[0].added, '2026-10-01', 'keeps when it was written')
})

test('ticking checklist items in an entry, skipping ones in code blocks', () => {
  const model = parseNotebook('Intro\n- [ ] intro item\n\n## List\n```\n- [ ] not a real item\n```\n- [ ] one\n- [x] two')
  const entry = model.sections[0].entries[0]
  toggleCheck(model, entry.id, 0, TODAY)
  toggleCheck(model, entry.id, 1, TODAY)
  assert.equal(entry.text, '```\n- [ ] not a real item\n```\n- [x] one\n- [ ] two')
  toggleCheck(model, model.entries[0].id, 0, TODAY)
  assert.equal(model.entries[0].text, 'Intro\n- [x] intro item')
})

test('moving sections: never into itself, and only where it fits within five levels', () => {
  const model = parseNotebook('## A\n### A1\n#### A1a\n## B\n### B1\n#### B1a\n##### B1a-i')
  const a = find(model, 'A')
  const targets = moveTargets(model, a.id).map((target) => target.title)
  assert.ok(!targets.includes('A1') && !targets.includes('A1a'), 'not into its own sections')
  assert.ok(!targets.includes('Top level'), 'already at the top')
  assert.deepEqual(targets, ['B', 'B1'], 'A is three levels deep, so B1a would be too deep')
  assert.equal(moveSection(model, a.id, find(model, 'B1a').id), false)
  assert.equal(moveSection(model, a.id, find(model, 'B').id), true)
  assert.deepEqual(titles(find(model, 'B').children), ['B1', 'A'])
  assert.deepEqual(
    pathTo(model, find(model, 'A1a').id).map((section) => section.title),
    ['B', 'A', 'A1', 'A1a'],
  )
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
  deleteSection(model, find(model, 'Sleep').id)
  assert.deepEqual(titles(model.sections), ['Exercise'])
  assert.equal(find(model, 'Morning routine'), null)
})

test('search: name matches first, with the path, a snippet and the matching entry', () => {
  const model = parseNotebook(DOCUMENTED)
  const results = searchNotebook(model, 'routine')
  assert.equal(results[0].title, 'Morning routine')
  assert.equal(results[0].inTitle, true)
  assert.deepEqual(results[0].path, ['Sleep'])
  const naps = searchNotebook(model, 'naps')
  assert.deepEqual(
    naps.map((result) => [result.title, result.inTitle]),
    [['Sleep', false]],
  )
  assert.equal(naps[0].entryId, find(model, 'Sleep').entries[1].id, 'points at the second entry')
  assert.match(naps[0].snippet, /later thought about naps/)
  assert.deepEqual(searchNotebook(model, '   '), [])
  assert.equal(sectionText(find(model, 'Sleep')), 'Notes about sleep.\n\nA later thought about naps.')
  const sam = searchNotebook(model, 'sam')
  assert.deepEqual(
    sam.map((result) => [result.id, result.title, result.path, result.entryId]),
    [[null, null, [], model.entries[1].id]],
    "the notebook's own entries are searched too",
  )
})

test('the note-list preview counts sections and shows the latest edit', () => {
  assert.equal(previewNotebook(parseNotebook(DOCUMENTED), TODAY), '4 sections · edited Oct 22', 'a thought counts as an edit')
  assert.equal(previewNotebook(parseNotebook(''), TODAY), 'Empty notebook')
  assert.equal(previewNotebook(parseNotebook('Just a thought'), TODAY), 'No sections yet')
  assert.equal(previewNotebook(parseNotebook('## Only'), TODAY), '1 section')
})
