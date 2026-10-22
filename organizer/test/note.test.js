import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinNote, splitNote } from '../src/note.js'

test('reads the template and its settings from the marker line', () => {
  const note = splitNote('<!-- organizer: todos · reviewed 2026-10-20 -->\n\n- [ ] Call the plumber')
  assert.deepEqual(note, {
    template: 'todos',
    meta: { reviewed: '2026-10-20' },
    body: '\n- [ ] Call the plumber',
  })
})

test('finds the marker below blank lines and with Windows line endings', () => {
  const note = splitNote('\r\n  <!-- organizer: people -->\r\n## Sam')
  assert.equal(note.template, 'people')
  assert.equal(note.body, '## Sam')
})

test('a note without a marker has no template and keeps all its text', () => {
  const text = 'Shopping\n<!-- organizer: todos -->'
  assert.deepEqual(splitNote(text), { template: null, meta: {}, body: text })
  assert.equal(splitNote('').template, null)
})

test('writes the marker, skipping empty settings, then the body', () => {
  assert.equal(
    joinNote({ template: 'todos', meta: { reviewed: '2026-10-20', other: null }, body: '\n\n- [ ] a\n\n' }),
    '<!-- organizer: todos · reviewed 2026-10-20 -->\n\n- [ ] a',
  )
  assert.equal(joinNote({ template: 'todos', meta: { reviewed: null }, body: '' }), '<!-- organizer: todos -->')
})

test('splitting what was joined gives back the same parts', () => {
  const parts = { template: 'todos', meta: { reviewed: '2026-10-20' }, body: '- [ ] a' }
  const again = splitNote(joinNote(parts))
  assert.equal(again.template, 'todos')
  assert.deepEqual(again.meta, parts.meta)
  assert.equal(again.body.trim(), parts.body)
})
