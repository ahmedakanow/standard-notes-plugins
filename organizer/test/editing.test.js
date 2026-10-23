import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertLink, prefixLines, wrap } from '../src/editing.js'

test('wrap puts markers around the selection and keeps it selected', () => {
  assert.deepEqual(wrap({ value: 'a big deal', start: 2, end: 5 }, '**'), { value: 'a **big** deal', start: 4, end: 7 })
  assert.deepEqual(wrap({ value: 'ab', start: 1, end: 1 }, '_'), { value: 'a_text_b', start: 2, end: 6 })
})

test('prefixLines adds a prefix to the lines the selection touches, or removes it', () => {
  const value = 'milk\neggs\nbread'
  const added = prefixLines({ value, start: 2, end: 7 }, '- ')
  assert.equal(added.value, '- milk\n- eggs\nbread')
  const removed = prefixLines({ value: added.value, start: 0, end: added.value.indexOf('bread') - 1 }, '- ')
  assert.equal(removed.value, value)
  const single = prefixLines({ value: 'milk', start: 4, end: 4 }, '- [ ] ')
  assert.deepEqual(single, { value: '- [ ] milk', start: 10, end: 10 })
})

test('insertLink wraps the selection and selects the address to type', () => {
  const result = insertLink({ value: 'see docs here', start: 4, end: 8 })
  assert.equal(result.value, 'see [docs](https://) here')
  assert.equal(result.value.slice(result.start, result.end), 'https://')
})
