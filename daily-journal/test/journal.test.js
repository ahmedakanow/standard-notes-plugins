import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countEntryWords,
  countWords,
  createEntry,
  formatDateHeading,
  parseDateHeading,
  parseEntry,
  previewFor,
  promptForDate,
  PROMPTS,
  serializeEntry,
} from '../src/journal.js'

function sampleEntry() {
  const entry = createEntry('2026-10-22')
  entry.mood = 'good'
  entry.sections.gratitude = 'Coffee\nA long walk'
  entry.sections.journal = 'Shipped the plugin.\n\n    indented line kept'
  entry.prompt = { question: 'What made you smile today?', answer: 'The dog.' }
  return entry
}

test('serializes to readable Markdown and skips empty sections', () => {
  assert.equal(
    serializeEntry(sampleEntry()),
    [
      '# Thursday, October 22, 2026',
      'Mood: 🙂 Good',
      '',
      '## Grateful for',
      'Coffee',
      'A long walk',
      '',
      '## Journal',
      'Shipped the plugin.',
      '',
      '    indented line kept',
      '',
      '## 💭 What made you smile today?',
      'The dog.',
    ].join('\n'),
  )
})

test('parses what it serializes', () => {
  const entry = sampleEntry()
  assert.deepEqual(parseEntry(serializeEntry(entry)), entry)
})

test('serializing is stable after untidy input', () => {
  const entry = sampleEntry()
  entry.sections.focus = '\n\n  Write tests  \n\n'
  const once = serializeEntry(entry)
  assert.equal(serializeEntry(parseEntry(once)), once)
})

test('keeps plain text from a note that was not a journal entry', () => {
  const text = '# Shopping\n- milk\n- eggs\n\nMood: whatever'
  const entry = parseEntry(text)
  assert.equal(entry.date, null)
  assert.equal(entry.mood, null)
  assert.equal(entry.preamble, text)
  assert.equal(serializeEntry(entry), text)
})

test('keeps unknown and repeated sections as extras', () => {
  const entry = parseEntry('## Journal\nfirst\n\n## Dreams\nflying\n\n## Journal\nsecond\n\n## Empty')
  assert.equal(entry.sections.journal, 'first')
  assert.deepEqual(entry.extras, [
    { heading: 'Dreams', body: 'flying' },
    { heading: 'Journal', body: 'second' },
    { heading: 'Empty', body: '' },
  ])
  assert.match(serializeEntry(entry), /## Dreams\nflying\n\n## Journal\nsecond\n\n## Empty$/)
})

test('reads Windows line endings', () => {
  const entry = parseEntry('# October 22, 2026\r\nMood: great\r\n\r\n## Journal\r\nHi')
  assert.equal(entry.date, '2026-10-22')
  assert.equal(entry.mood, 'great')
  assert.equal(entry.sections.journal, 'Hi')
})

test('only treats a date heading at the very top as the entry date', () => {
  const entry = parseEntry('Intro line\n# October 22, 2026')
  assert.equal(entry.date, null)
  assert.equal(entry.preamble, 'Intro line\n# October 22, 2026')
})

test('date headings', () => {
  assert.equal(formatDateHeading('2026-10-22'), 'Thursday, October 22, 2026')
  assert.equal(formatDateHeading('2024-02-29'), 'Thursday, February 29, 2024')
  assert.equal(parseDateHeading('Thursday, October 22, 2026'), '2026-10-22')
  assert.equal(parseDateHeading('october 5, 2026'), '2026-10-05')
  assert.equal(parseDateHeading('2026-10-22'), '2026-10-22')
  assert.equal(parseDateHeading('February 30, 2026'), null)
  assert.equal(parseDateHeading('Shopping'), null)
})

test('prompts are stable per date and step with the offset', () => {
  assert.equal(promptForDate('2026-10-22'), promptForDate('2026-10-22'))
  assert.notEqual(promptForDate('2026-10-22'), promptForDate('2026-10-23'))
  assert.equal(promptForDate('2026-10-22', 1), promptForDate('2026-10-23'))
  assert.equal(promptForDate('2026-10-22', -PROMPTS.length), promptForDate('2026-10-22'))
})

test('an answered prompt without a stored question falls back to the date prompt', () => {
  const entry = createEntry('2026-10-22')
  entry.prompt.answer = 'Something'
  assert.ok(serializeEntry(entry).includes(`## 💭 ${promptForDate('2026-10-22')}\nSomething`))
})

test('counts words, ignoring punctuation', () => {
  assert.equal(countWords("Hello, world — it's fine."), 4)
  assert.equal(countWords('   '), 0)
  assert.equal(countEntryWords(sampleEntry()), 12)
})

test('preview leads with the mood and the journal text, then truncates', () => {
  assert.equal(previewFor(sampleEntry()), '🙂 Shipped the plugin. indented line kept')
  const long = createEntry('2026-10-22')
  long.sections.journal = 'word '.repeat(100)
  const preview = previewFor(long, 20)
  assert.equal(Array.from(preview).length, 20)
  assert.ok(preview.endsWith('…'))
})
