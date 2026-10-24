import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checklistLines, inline, plainPreview, renderMarkdown, toggleChecklist } from '../src/markdown.js'

test('paragraphs keep single line breaks', () => {
  assert.deepEqual(renderMarkdown('one\ntwo\n\nthree'), [
    { tag: 'p', children: ['one', { tag: 'br' }, 'two'] },
    { tag: 'p', children: ['three'] },
  ])
})

test('bold, italic, strikethrough and code; snake_case stays plain', () => {
  assert.deepEqual(inline('**bold** _it_ ~~gone~~ `x * y` snake_case_name'), [
    { tag: 'strong', children: ['bold'] },
    ' ',
    { tag: 'em', children: ['it'] },
    ' ',
    { tag: 'del', children: ['gone'] },
    ' ',
    { tag: 'code', children: ['x * y'] },
    ' snake_case_name',
  ])
})

test('HTML is never markup, just text', () => {
  assert.deepEqual(renderMarkdown('<img src=x onerror=alert(1)> <b>hi</b>'), [
    { tag: 'p', children: ['<img src=x onerror=alert(1)> <b>hi</b>'] },
  ])
})

test('underline is the one exception, and only as a <u> pair', () => {
  assert.deepEqual(inline('<u>under **this**</u> and <u>unclosed'), [
    { tag: 'u', children: ['under ', { tag: 'strong', children: ['this'] }] },
    ' and <u>unclosed',
  ])
  assert.deepEqual(inline('<u onclick="x()">no</u>'), ['<u onclick="x()">no</u>'], 'attributes mean it stays text')
})

test('links open in a new tab; unsafe links and images do not become live', () => {
  const [link] = inline('[site](https://example.com)')
  assert.deepEqual(link, {
    tag: 'a',
    props: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer' },
    children: ['site'],
  })
  assert.deepEqual(inline('[click](javascript:alert(1))'), [{ tag: 'span', children: ['click'] }, ')'])
  const [image] = inline('![a cat](https://example.com/cat.png)')
  assert.equal(image.tag, 'a')
  assert.deepEqual(image.children, ['🖼 a cat'])
  assert.equal(inline('see https://example.com.')[1].props.href, 'https://example.com')
})

test('nested lists, and numbered checklists that can be ticked', () => {
  const [list] = renderMarkdown('- [ ] one\n  - plain\n- [x] two')
  assert.equal(list.tag, 'ul')
  const [first, second] = list.children
  assert.deepEqual(first.children[0].props, { type: 'checkbox', checked: false, dataset: { check: '0' } })
  assert.equal(first.children.at(-1).tag, 'ul', 'the indented item nests')
  assert.deepEqual(second.children[0].props, { type: 'checkbox', checked: true, dataset: { check: '1' } })
  assert.equal(renderMarkdown('1. a\n2. b')[0].tag, 'ol')
})

test('checklists in quotes are shown but cannot be ticked', () => {
  const [quote] = renderMarkdown('> - [ ] quoted')
  assert.equal(quote.tag, 'blockquote')
  assert.deepEqual(quote.children[0].children[0].children[0].props, { type: 'checkbox', checked: false, disabled: true })
})

test('code blocks keep their text, even lines that look like Markdown', () => {
  assert.deepEqual(renderMarkdown('```\n# not a heading\n- not a list\n```'), [
    { tag: 'pre', children: [{ tag: 'code', children: ['# not a heading\n- not a list'] }] },
  ])
})

test('checklist numbering skips code blocks, and toggling flips the right one', () => {
  const text = '- [ ] a\n```\n- [ ] code\n```\n- [x] b'
  assert.deepEqual(checklistLines(text), [0, 4])
  assert.equal(toggleChecklist(text, 1), '- [ ] a\n```\n- [ ] code\n```\n- [ ] b')
  assert.equal(toggleChecklist(text, 0), '- [x] a\n```\n- [ ] code\n```\n- [x] b')
  assert.equal(toggleChecklist(text, 5), text, 'out of range does nothing')
})

test('previews are the first line without Markdown symbols', () => {
  assert.equal(plainPreview('\n- [ ] **Buy** [filters](https://x.y)\nmore'), 'Buy filters')
  assert.equal(plainPreview('1. <u>Really</u> soon'), 'Really soon')
  assert.equal(plainPreview('a'.repeat(200), 20).length, 20)
  assert.equal(plainPreview(''), '')
})
