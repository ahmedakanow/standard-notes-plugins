import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EVERY_DAY,
  addTodos,
  allTags,
  bringBack,
  complete,
  describeDays,
  doToday,
  editTodo,
  normalizeTodos,
  parseDays,
  parseTodos,
  previewTodos,
  reopen,
  reviewDue,
  routineFor,
  sections,
  serializeTodos,
  setDue,
  setRepeat,
  undoToday,
} from '../src/todos.js'

const TODAY = '2026-10-22' // a Thursday

const DOCUMENTED = [
  '- [ ] Renew passport (2026-10-01, due 2026-11-15) #admin',
  '- [ ] Call the plumber (2026-10-22) #home',
  '',
  '## Parked',
  '- [ ] Learn Spanish (2026-08-01) #personal',
  '',
  '## Done',
  '- [x] Buy milk (2026-10-20, done 2026-10-21) #home',
].join('\n')

const strip = (items) => items.map(({ id, ...rest }) => rest)
const texts = (items) => items.map((item) => item.text)

test('reads the documented format', () => {
  const model = parseTodos(DOCUMENTED, { reviewed: '2026-10-20' })
  const plain = { repeat: null, streak: 0 }
  assert.deepEqual(strip(model.items), [
    { text: 'Renew passport', tags: ['admin'], status: 'active', touched: '2026-10-01', due: '2026-11-15', done: null, ...plain },
    { text: 'Call the plumber', tags: ['home'], status: 'active', touched: '2026-10-22', due: null, done: null, ...plain },
    { text: 'Learn Spanish', tags: ['personal'], status: 'parked', touched: '2026-08-01', due: null, done: null, ...plain },
    { text: 'Buy milk', tags: ['home'], status: 'done', touched: '2026-10-20', due: null, done: '2026-10-21', ...plain },
  ])
  assert.equal(model.reviewed, '2026-10-20')
  assert.equal(model.other, '')
})

test('writes the documented format back exactly', () => {
  const model = parseTodos(DOCUMENTED, { reviewed: '2026-10-20' })
  assert.deepEqual(serializeTodos(model, TODAY), { body: DOCUMENTED, meta: { reviewed: '2026-10-20' } })
})

test('hand-typed todos are valid and get dated when first seen', () => {
  const model = parseTodos('- [ ] buy bread\n- call mum\n* fix bike #home\n- [X] posted the letter', {})
  assert.deepEqual(texts(model.items), ['buy bread', 'call mum', 'fix bike', 'posted the letter'])
  assert.deepEqual(
    model.items.map((item) => item.touched),
    [null, null, null, null],
  )
  assert.equal(normalizeTodos(model, { today: TODAY }), true)
  assert.ok(model.items.every((item) => item.touched === TODAY))
  assert.equal(model.items[3].done, TODAY)
  assert.equal(normalizeTodos(model, { today: TODAY }), false, 'normalizing twice changes nothing')
})

test('brackets and hashes that are part of the text stay in the text', () => {
  const model = parseTodos(
    ['- [ ] Call mum (re: birthday)', '- [ ] Pay Sam back (half of £40) (2026-10-01)', '- [ ] Fix issue #5'].join('\n'),
  )
  assert.deepEqual(texts(model.items), ['Call mum (re: birthday)', 'Pay Sam back (half of £40)', 'Fix issue #5'])
  assert.equal(model.items[1].touched, '2026-10-01')
  assert.deepEqual(model.items[2].tags, [])
})

test('text that is not a todo is kept, including sections it does not know', () => {
  const body = ['Remember: bins go out on Tuesday', '- [ ] a (2026-10-22)', '', '## Shopping list', '- milk', '- eggs'].join(
    '\n',
  )
  const model = parseTodos(body)
  assert.deepEqual(texts(model.items), ['a'])
  assert.equal(model.other, 'Remember: bins go out on Tuesday\n\n## Shopping list\n- milk\n- eggs')
  const once = serializeTodos(model, TODAY).body
  assert.equal(serializeTodos(parseTodos(once), TODAY).body, once, 'stable when re-read')
})

test('parks todos untouched for the stale period, but never ones with a due date', () => {
  const model = parseTodos(
    [
      '- [ ] fourteen days (2026-10-08)',
      '- [ ] thirteen days (2026-10-09)',
      '- [ ] old but due (2026-01-01, due 2026-12-01)',
      '- [ ] old and overdue (2026-01-01, due 2026-02-01)',
    ].join('\n'),
  )
  assert.equal(normalizeTodos(model, { today: TODAY, staleDays: 14 }), true)
  assert.deepEqual(
    model.items.map((item) => item.status),
    ['parked', 'active', 'active', 'active'],
  )
  model.items[1].status = 'active'
  normalizeTodos(model, { today: TODAY, staleDays: 7 })
  assert.equal(model.items[1].status, 'parked', 'a shorter setting parks sooner')
})

test('orders overdue, then by due date, then newest; parked and done newest first', () => {
  const model = parseTodos(
    [
      '- [ ] no due, older (2026-10-01)',
      '- [ ] due later (2026-10-10, due 2026-11-30)',
      '- [ ] overdue (2026-10-10, due 2026-10-20)',
      '- [ ] no due, newer (2026-10-21)',
      '- [ ] due sooner (2026-10-10, due 2026-10-25)',
      '- [ ] very overdue (2026-10-10, due 2026-10-01)',
      '## Parked',
      '- [ ] parked older (2026-08-01)',
      '- [ ] parked newer (2026-09-01)',
      '## Done',
      '- [x] done older (2026-10-01, done 2026-10-02)',
      '- [x] done newer (2026-10-01, done 2026-10-12)',
    ].join('\n'),
  )
  const { active, parked, done } = sections(model, TODAY)
  assert.deepEqual(texts(active), [
    'very overdue',
    'overdue',
    'due sooner',
    'due later',
    'no due, newer',
    'no due, older',
  ])
  assert.deepEqual(texts(parked), ['parked newer', 'parked older'])
  assert.deepEqual(texts(done), ['done newer', 'done older'])
})

test('a review is due weekly while anything is parked', () => {
  const withParked = (reviewed) => parseTodos('## Parked\n- [ ] x (2026-08-01)', { reviewed })
  assert.equal(reviewDue(parseTodos('- [ ] x (2026-10-22)'), TODAY), false, 'nothing parked')
  assert.equal(reviewDue(withParked(undefined), TODAY), true, 'never reviewed')
  assert.equal(reviewDue(withParked('2026-10-16'), TODAY), false, 'six days ago')
  assert.equal(reviewDue(withParked('2026-10-15'), TODAY), true, 'seven days ago')
})

test('adds one todo per pasted line, with tags and the chosen due date', () => {
  const model = parseTodos('')
  const added = addTodos(model, '- [ ] Book flights #travel\n2. Renew insurance\n\n   * Pack', {
    today: TODAY,
    due: '2026-11-01',
  })
  const fresh = { status: 'active', touched: TODAY, due: '2026-11-01', done: null, repeat: null, streak: 0 }
  assert.deepEqual(strip(added), [
    { text: 'Book flights', tags: ['travel'], ...fresh },
    { text: 'Renew insurance', tags: [], ...fresh },
    { text: 'Pack', tags: [], ...fresh },
  ])
  assert.deepEqual(allTags(model), ['travel'])
  assert.deepEqual(addTodos(model, '  \n - ', { today: TODAY }), [], 'blank input adds nothing')
})

test('editing, finishing and bringing back update the dates', () => {
  const model = parseTodos('- [ ] Call plumber (2026-10-01)\n## Parked\n- [ ] Learn Spanish (2026-08-01)')
  const [call, spanish] = model.items

  assert.equal(editTodo(call, 'Call the plumber #home', TODAY), true)
  assert.deepEqual([call.text, call.tags, call.touched], ['Call the plumber', ['home'], TODAY])
  assert.equal(editTodo(call, '   ', TODAY), false)
  assert.equal(call.text, 'Call the plumber', 'empty edits are ignored')

  complete(call, '2026-10-23')
  assert.deepEqual([call.status, call.done], ['done', '2026-10-23'])
  reopen(call, '2026-10-24')
  assert.deepEqual([call.status, call.done, call.touched], ['active', null, '2026-10-24'])

  bringBack(spanish, TODAY)
  assert.deepEqual([spanish.status, spanish.touched], ['active', TODAY])
})

const routineItem = (details) => parseTodos(`- [ ] Work out (${details})`).items[0]

test('repeating todos keep their schedule, last done day and streak in the text', () => {
  const text = [
    '- [x] Work out (2026-10-01, every day, done 2026-10-22, streak 5) #health',
    '- [ ] Stretch (2026-10-01, every mon wed fri, done 2026-10-21, streak 3)',
    '- [ ] Stand-up notes (2026-10-01, every weekday)',
  ].join('\n')
  const model = parseTodos(text)
  assert.deepEqual(
    model.items.map((item) => [item.text, item.repeat, item.done, item.streak, item.status]),
    [
      ['Work out', EVERY_DAY, '2026-10-22', 5, 'active'],
      ['Stretch', [1, 3, 5], '2026-10-21', 3, 'active'],
      ['Stand-up notes', [1, 2, 3, 4, 5], null, 0, 'active'],
    ],
  )
  assert.equal(serializeTodos(model, TODAY).body, text)
})

test('schedules can be written with full or short day names', () => {
  assert.deepEqual(parseDays('Monday Friday'), [1, 5])
  assert.deepEqual(parseDays('sun tues'), [0, 2])
  assert.equal(parseDays('blursday'), null)
  assert.equal(describeDays([1, 3, 5]), 'Mon, Wed, Fri')
  assert.equal(describeDays([0, 6]), 'Sat, Sun')
  assert.equal(describeDays(EVERY_DAY), 'Every day')
  const party = parseTodos('- [ ] Party (every blursday)').items[0]
  assert.deepEqual([party.text, party.repeat], ['Party (every blursday)', null])
})

test("a repeating todo's checkbox only shows whether it's done today", () => {
  const model = parseTodos('- [x] Work out (2026-10-01, every day, done 2026-10-21, streak 2)')
  assert.equal(model.items[0].status, 'active')
  assert.equal(serializeTodos(model, TODAY).body, '- [ ] Work out (2026-10-01, every day, done 2026-10-21, streak 2)')
})

test('ticking extends the streak only if the last scheduled day was done', () => {
  const kept = routineItem('2026-10-01, every day, done 2026-10-21, streak 4')
  doToday(kept, TODAY)
  assert.deepEqual([kept.done, kept.streak], [TODAY, 5])
  doToday(kept, TODAY)
  assert.equal(kept.streak, 5, 'ticking twice counts once')

  const broken = routineItem('2026-10-01, every day, done 2026-10-20, streak 4')
  doToday(broken, TODAY)
  assert.equal(broken.streak, 1)

  const first = routineItem('2026-10-01, every day')
  doToday(first, TODAY)
  assert.equal(first.streak, 1)

  const mwf = routineItem('2026-10-01, every mon wed fri, done 2026-10-19, streak 2')
  doToday(mwf, '2026-10-21') // Wednesday, after Monday's
  assert.equal(mwf.streak, 3, 'unscheduled days in between do not break it')
})

test('unticking today puts the streak back', () => {
  const item = routineItem('2026-10-01, every day, done 2026-10-21, streak 4')
  doToday(item, TODAY)
  undoToday(item, TODAY)
  assert.deepEqual([item.done, item.streak], ['2026-10-21', 4])

  const first = routineItem('2026-10-01, every day')
  doToday(first, TODAY)
  undoToday(first, TODAY)
  assert.deepEqual([first.done, first.streak], [null, 0])
})

test('a missed scheduled day ends the streak when the note opens', () => {
  const streakAfterOpening = (details) => {
    const model = parseTodos(`- [ ] Work out (${details})`)
    normalizeTodos(model, { today: TODAY })
    return model.items[0].streak
  }
  assert.equal(streakAfterOpening('2026-10-01, every day, done 2026-10-20, streak 4'), 0)
  assert.equal(streakAfterOpening('2026-10-01, every day, done 2026-10-21, streak 4'), 4)
  assert.equal(streakAfterOpening('2026-10-01, every mon wed fri, done 2026-10-19, streak 3'), 0, 'missed Wednesday')
  assert.equal(streakAfterOpening('2026-10-01, every mon wed fri, done 2026-10-21, streak 3'), 3, 'Thursday is a day off')
})

test('repeating todos are never parked and stay out of Parked, Done and reviews', () => {
  const model = parseTodos('- [ ] Work out (2026-01-01, every day)\n## Parked\n- [ ] Floss (2026-01-01, every day)')
  normalizeTodos(model, { today: TODAY })
  const { routine, parked, done } = sections(model, TODAY)
  assert.deepEqual(texts(routine), ['Work out', 'Floss'])
  assert.deepEqual([parked, done], [[], []])
  assert.equal(reviewDue(model, TODAY), false)
})

test("today's routine is what's scheduled today, plus anything already done today", () => {
  const model = parseTodos(
    [
      '- [ ] Every day (2026-10-01, every day)',
      '- [ ] Mon Wed Fri (2026-10-01, every mon wed fri)',
      '- [ ] Tue Thu (2026-10-01, every tue thu)',
      '- [ ] Done before the schedule changed (2026-10-01, every fri, done 2026-10-22, streak 1)',
    ].join('\n'),
  )
  const { today, later } = routineFor(model, TODAY)
  assert.deepEqual(texts(today), ['Every day', 'Tue Thu', 'Done before the schedule changed'])
  assert.deepEqual(texts(later), ['Mon Wed Fri'])
})

test('making a todo repeat, and stopping', () => {
  const [item] = parseTodos('- [ ] Work out (2026-10-01)').items
  setDue(item, '2026-11-01', TODAY)
  setRepeat(item, [5, 1, 3, 1], TODAY)
  assert.deepEqual([item.repeat, item.due, item.status], [[1, 3, 5], null, 'active'], 'due dates do not apply')
  doToday(item, TODAY)
  setRepeat(item, [], TODAY)
  assert.deepEqual([item.repeat, item.done, item.streak, item.touched], [null, null, 0, TODAY])
})

test('the note-list preview summarises the list', () => {
  const model = parseTodos(
    [
      '- [ ] Renew passport (2026-10-01, due 2026-10-20)',
      '- [ ] Call the plumber (2026-10-22)',
      '## Parked',
      '- [ ] Learn Spanish (2026-08-01)',
    ].join('\n'),
  )
  assert.equal(previewTodos(model, TODAY), '2 to do · 1 overdue · 1 parked · Next: Renew passport')
  assert.equal(previewTodos(parseTodos(''), TODAY), 'No todos yet')
  const withRoutine = parseTodos(
    `- [ ] Work out (2026-10-01, every day, done ${TODAY}, streak 1)\n- [ ] Read (2026-10-01, every day)`,
  )
  assert.equal(previewTodos(withRoutine, TODAY), 'Routine 1/2 · 0 to do')
})
