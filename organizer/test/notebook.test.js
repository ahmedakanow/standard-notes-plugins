import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DEPTH,
  addSection,
  addThought,
  countInside,
  deleteSection,
  findUnsorted,
  height,
  locate,
  moveSection,
  moveSectionByOne,
  moveTargets,
  parseNotebook,
  pathTo,
  previewNotebook,
  renameSection,
  reorderSection,
  searchNotebook,
  sectionFromText,
  serializeNotebook,
  setSectionText,
  toggleCheck,
} from '../src/notebook.js'

const TODAY = '2026-10-23'

const DOCUMENTED = [
  'Everything about sleeping better.',
  '',
  '## Sleep',
  '<!-- edited 2026-10-20 -->',
  'Notes about sleep.',
  '',
  '### Morning routine',
  'Wake at 7, no phone for the first hour.',
  '',
  '### What the doctor said',
  '<!-- edited 2026-10-01 -->',
  '- Magnesium before bed',
  '- [ ] Book a follow-up',
  '',
  '## Exercise',
].join('\n')

const titles = (sections) => sections.map((section) => section.title)
const find = (model, title) => model && locateByTitle(model, title)
function locateByTitle(model, title) {
  const stack = [...model.sections]
  while (stack.length) {
    const section = stack.shift()
    if (section.title === title) return section
    stack.push(...section.children)
  }
  return null
}

test('reads the documented format: intro, nested sections, edited dates', () => {
  const model = parseNotebook(DOCUMENTED)
  assert.equal(model.intro, 'Everything about sleeping better.')
  assert.deepEqual(titles(model.sections), ['Sleep', 'Exercise'])
  const sleep = model.sections[0]
  assert.deepEqual([sleep.text, sleep.edited], ['Notes about sleep.', '2026-10-20'])
  assert.deepEqual(titles(sleep.children), ['Morning routine', 'What the doctor said'])
  assert.equal(sleep.children[0].edited, null)
  assert.equal(sleep.children[1].text, '- Magnesium before bed\n- [ ] Book a follow-up')
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

test('headings inside code blocks stay text', () => {
  const model = parseNotebook('## Shell\n```\n## not a section\n```')
  assert.equal(model.sections[0].children.length, 0)
  assert.equal(model.sections[0].text, '```\n## not a section\n```')
})

test('text that looks like a heading is escaped when saved and read back as text', () => {
  const model = parseNotebook('## Notes')
  setSectionText(model, model.sections[0].id, 'Before\n## Not a section\nAfter', TODAY)
  const body = serializeNotebook(model).body
  assert.match(body, /\n\\## Not a section\n/)
  const again = parseNotebook(body)
  assert.equal(again.sections[0].children.length, 0)
  assert.equal(again.sections[0].text, 'Before\n## Not a section\nAfter')
})

test('a pasted note: first line is the name, its headings become sub-sections', () => {
  const pasted = '# Sleep\nI sleep badly.\n\n# Tips\nNo coffee after 2pm.\n## Supplements\nMagnesium.'
  const section = sectionFromText(pasted, TODAY)
  assert.deepEqual([section.title, section.text, section.edited], ['Sleep', 'I sleep badly.', TODAY])
  assert.deepEqual(titles(section.children), ['Tips'])
  assert.equal(section.children[0].text, 'No coffee after 2pm.')
  assert.deepEqual(titles(section.children[0].children), ['Supplements'])
})

test('pasted headings deeper than the room left become bold lines', () => {
  const section = sectionFromText('Sleep\n# Tips\nNo coffee\n## Supplements\nMagnesium', TODAY, 1)
  assert.deepEqual(titles(section.children), ['Tips'])
  assert.equal(section.children[0].text, 'No coffee\n**Supplements**\nMagnesium')
})

test('a long first line is shortened for the name and kept in the text', () => {
  const line = 'This is a very long first line of a pasted note that keeps going well past the point where a name should stop'
  const section = sectionFromText(`${line}\nmore`, TODAY)
  assert.ok(section.title.endsWith('…'))
  assert.ok(section.title.length <= 81)
  assert.equal(section.text, `${line}\nmore`)
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

test('thoughts go to the top of Unsorted, which is created at the top', () => {
  const model = parseNotebook('## Sleep')
  addThought(model, 'Try magnesium', TODAY)
  addThought(model, 'Ask Sam about his app\nHe mentioned it on Friday', TODAY)
  const unsorted = findUnsorted(model)
  assert.equal(model.sections[0], unsorted)
  assert.deepEqual(titles(unsorted.children), ['Ask Sam about his app', 'Try magnesium'])
  assert.equal(unsorted.children[0].text, 'He mentioned it on Friday')
  assert.equal(addThought(model, '  ', TODAY), null)
})

test('renaming and editing text set the edited date only when something changes', () => {
  const model = parseNotebook(DOCUMENTED)
  const routine = find(model, 'Morning routine')
  setSectionText(model, routine.id, routine.text, TODAY)
  assert.equal(routine.edited, null, 'unchanged text')
  setSectionText(model, routine.id, 'Wake at 6', TODAY)
  assert.equal(routine.edited, TODAY)
  const exercise = find(model, 'Exercise')
  assert.equal(renameSection(model, exercise.id, '  ## Training  ', TODAY), true)
  assert.deepEqual([exercise.title, exercise.edited], ['Training', TODAY])
  assert.equal(renameSection(model, exercise.id, '   ', TODAY), false)
})

test('ticking checklist items, skipping ones in code blocks', () => {
  const model = parseNotebook('Intro\n- [ ] intro item\n\n## List\n```\n- [ ] not a real item\n```\n- [ ] one\n- [x] two')
  const list = model.sections[0]
  toggleCheck(model, list.id, 0, TODAY)
  toggleCheck(model, list.id, 1, TODAY)
  assert.equal(list.text, '```\n- [ ] not a real item\n```\n- [x] one\n- [ ] two')
  toggleCheck(model, 'intro', 0, TODAY)
  assert.equal(model.intro, 'Intro\n- [x] intro item')
})

test('moving: never into itself, and only where it fits within five levels', () => {
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

test('reordering siblings', () => {
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

test('search: name matches first, with the path and a snippet', () => {
  const model = parseNotebook(DOCUMENTED)
  const results = searchNotebook(model, 'routine')
  assert.equal(results[0].title, 'Morning routine')
  assert.equal(results[0].inTitle, true)
  assert.deepEqual(results[0].path, ['Sleep'])
  const byText = searchNotebook(model, 'magnesium')
  assert.deepEqual(
    byText.map((result) => [result.title, result.inTitle]),
    [['What the doctor said', false]],
  )
  assert.match(byText[0].snippet, /Magnesium before bed/)
  assert.deepEqual(searchNotebook(model, '   '), [])
})

test('the note-list preview counts sections and shows the latest edit', () => {
  assert.equal(previewNotebook(parseNotebook(DOCUMENTED), TODAY), '4 sections · edited Oct 20')
  assert.equal(previewNotebook(parseNotebook(''), TODAY), 'Empty notebook')
  assert.equal(previewNotebook(parseNotebook('## Only'), TODAY), '1 section')
})
