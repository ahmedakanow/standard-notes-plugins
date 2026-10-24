// The Markdown that Notebook shows formatted: paragraphs (single line breaks kept), bold,
// italic, strikethrough, inline code, code blocks, bullet/numbered/check lists (nested by
// indent), quotes, rules and links. Images become links, so opening a note never loads
// anything from the web.
//
// renderMarkdown returns a plain tree of { tag, props, children } nodes (strings are text).
// The view builds DOM from it with textContent only, so nothing in a note can inject HTML
// or run scripts.

const FENCE = /^\s*(```|~~~)/
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const CHECK = /^\[([ xX])\]\s+(.*)$/s
const CHECKLIST_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/

/** Line numbers of checklist items (`- [ ] …`) outside code blocks, in order. */
export function checklistLines(text) {
  const found = []
  let inFence = false
  text.split('\n').forEach((line, index) => {
    if (FENCE.test(line)) inFence = !inFence
    else if (!inFence && CHECKLIST_LINE.test(line)) found.push(index)
  })
  return found
}

/** Ticks or unticks the nth checklist item (as numbered by checklistLines). */
export function toggleChecklist(text, n) {
  const lines = text.split('\n')
  const index = checklistLines(text)[n]
  if (index === undefined) return text
  lines[index] = lines[index].replace(CHECKLIST_LINE, (_, open, mark, close) => `${open}${mark === ' ' ? 'x' : ' '}${close}`)
  return lines.join('\n')
}

export function renderMarkdown(text, { interactive = true } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  const counter = { next: 0, interactive }
  let i = 0
  const startsBlock = (line) => !line.trim() || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line)

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (FENCE.test(line)) {
      const marker = FENCE.exec(line)[1]
      const code = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) code.push(lines[i++])
      i++ // the closing fence
      blocks.push({ tag: 'pre', children: [{ tag: 'code', children: [code.join('\n')] }] })
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ tag: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const quoted = []
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(QUOTE.exec(lines[i++])[1])
      // Checklists inside quotes aren't counted by checklistLines, so they can't be ticked.
      blocks.push({ tag: 'blockquote', children: renderMarkdown(quoted.join('\n'), { interactive: false }) })
      continue
    }
    if (LIST_ITEM.test(line)) {
      const items = []
      while (i < lines.length) {
        const item = LIST_ITEM.exec(lines[i])
        if (item) {
          items.push({ indent: item[1].replace(/\t/g, '  ').length, ordered: /\d/.test(item[2]), content: item[3] })
        } else if (lines[i].trim() && /^\s/.test(lines[i])) {
          items.at(-1).content += `\n${lines[i].trim()}` // a wrapped line of the item above
        } else {
          break
        }
        i++
      }
      blocks.push(buildList(items, counter))
      continue
    }
    const paragraph = []
    while (i < lines.length && (paragraph.length === 0 || !startsBlock(lines[i]))) paragraph.push(lines[i++])
    // A heading-like line inside a section's text (sections themselves are the real headings).
    const heading = /^\\?#{1,6}\s+(.*)$/.exec(paragraph[0])
    if (heading && paragraph.length === 1) {
      blocks.push({ tag: 'p', props: { class: 'md-heading' }, children: inline(heading[1]) })
    } else {
      blocks.push({ tag: 'p', children: inline(paragraph.join('\n')) })
    }
  }
  return blocks
}

function buildList(items, counter) {
  const list = (ordered) => ({ tag: ordered ? 'ol' : 'ul', children: [] })
  const root = list(items[0].ordered)
  const stack = [{ indent: items[0].indent, node: root }]
  let lastItem = null
  for (const item of items) {
    while (stack.length > 1 && item.indent < stack.at(-1).indent) stack.pop()
    if (lastItem && item.indent > stack.at(-1).indent + 1) {
      const nested = list(item.ordered)
      lastItem.children.push(nested)
      stack.push({ indent: item.indent, node: nested })
    }
    lastItem = listItem(item.content, counter)
    stack.at(-1).node.children.push(lastItem)
  }
  return root
}

function listItem(content, counter) {
  const check = CHECK.exec(content)
  if (!check) return { tag: 'li', children: inline(content) }
  const box = { tag: 'input', props: { type: 'checkbox', checked: check[1] !== ' ' } }
  if (counter.interactive) box.props.dataset = { check: String(counter.next++) }
  else box.props.disabled = true
  return { tag: 'li', props: { class: 'md-check' }, children: [box, ' ', ...inline(check[2])] }
}

const SAFE_URL = /^(https?:|mailto:)/i
const link = (url, children) =>
  SAFE_URL.test(url)
    ? { tag: 'a', props: { href: url, target: '_blank', rel: 'noopener noreferrer' }, children }
    : { tag: 'span', children }

// Sticky patterns, tried at each position in turn.
const INLINE = [
  { pattern: /\\([\\`*_{}[\]()#+\-.!>~|])/y, make: (m) => m[1] },
  { pattern: /\n/y, make: () => ({ tag: 'br' }) },
  { pattern: /(`+)([\s\S]*?[^`])\1(?!`)/y, make: (m) => ({ tag: 'code', children: [m[2]] }) },
  { pattern: /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/y, make: (m) => link(m[2], [`🖼 ${m[1] || 'image'}`]) },
  { pattern: /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/y, make: (m) => link(m[2], inline(m[1])) },
  { pattern: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/y, make: (m) => ({ tag: 'strong', children: inline(m[2]) }) },
  { pattern: /~~(?=\S)([\s\S]*?\S)~~/y, make: (m) => ({ tag: 'del', children: inline(m[1]) }) },
  // Markdown has no underline; `<u>` is the one bit of HTML read, and only as this pair.
  { pattern: /<u>([\s\S]+?)<\/u>/iy, make: (m) => ({ tag: 'u', children: inline(m[1]) }) },
  {
    pattern: /([*_])(?=\S)([\s\S]*?\S)\1(?![*_\w])/y,
    make: (m) => ({ tag: 'em', children: inline(m[2]) }),
    wordStart: true, // `snake_case_words` aren't italics
  },
  { pattern: /https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/y, make: (m) => link(m[0], [m[0]]), wordStart: true },
]

export function inline(text) {
  const out = []
  let plain = ''
  let i = 0
  outer: while (i < text.length) {
    for (const { pattern, make, wordStart } of INLINE) {
      if (wordStart && /\w/.test(text[i - 1] ?? '')) continue
      pattern.lastIndex = i
      const match = pattern.exec(text)
      if (!match) continue
      const node = make(match)
      if (typeof node === 'string') plain += node
      else {
        if (plain) out.push(plain)
        plain = ''
        out.push(node)
      }
      i += match[0].length
      continue outer
    }
    plain += text[i++]
  }
  if (plain) out.push(plain)
  return out
}

/** The first line of some Markdown as plain text, for previews. */
export function plainPreview(text, length = 90) {
  const line = String(text)
    .split('\n')
    .find((candidate) => candidate.trim() && !FENCE.test(candidate))
  if (!line) return ''
  const plain = line
    .replace(/\\([\\`*_{}[\]()#+\-.!<>~|])/g, '$1') // Markdown's escapes, as the editor writes them
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]+|<\/?u>/gi, '')
    .replace(/^\\?#+\s+/, '')
    .trim()
  return plain.length > length ? `${plain.slice(0, length - 1).trimEnd()}…` : plain
}
