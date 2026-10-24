// The Notebook editor's toolbar. Each action takes a textarea's { value, start, end } and
// returns the new { value, start, end }, so they can be tested without a browser.

/**
 * Wraps the selection in a marker such as `**` (or a pair such as `<u>` and `</u>`),
 * selecting the wrapped text.
 */
export function wrap({ value, start, end }, marker, closing = marker) {
  const selected = value.slice(start, end) || 'text'
  return {
    value: `${value.slice(0, start)}${marker}${selected}${closing}${value.slice(end)}`,
    start: start + marker.length,
    end: start + marker.length + selected.length,
  }
}

const NUMBERED = /^\d+[.)] /
const BULLET = /^[-*+] /
const CHECKLIST = /^[-*+] \[[ xX]\] /

/** The lines the selection touches: { from, to, lines }. */
function touchedLines({ value, start, end }) {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', Math.max(end - (end > start && value[end - 1] === '\n' ? 1 : 0), start))
  const to = lineEnd === -1 ? value.length : lineEnd
  return { from, to, lines: value.slice(from, to).split('\n') }
}

/** Puts `changed` in place of the touched lines: on one line the caret moves with the text, across several they're selected. */
function replaceLines({ value, start, end }, { from, to, lines }, changed) {
  const text = changed.join('\n')
  const next = `${value.slice(0, from)}${text}${value.slice(to)}`
  if (lines.length === 1) {
    const shift = text.length - lines[0].length
    return { value: next, start: Math.max(from, start + shift), end: Math.max(from, end + shift) }
  }
  return { value: next, start: from, end: from + text.length }
}

/**
 * Adds a prefix such as `- ` to every line the selection touches, or removes it if all of
 * them already have it.
 */
export function prefixLines(state, prefix) {
  const touched = touchedLines(state)
  const remove = touched.lines.every((line) => line.startsWith(prefix))
  return replaceLines(
    state,
    touched,
    touched.lines.map((line) => (remove ? line.slice(prefix.length) : `${prefix}${line}`)),
  )
}

/**
 * Numbers the lines the selection touches (`1. `, `2. `, …), turning bullets into numbers
 * and renumbering ones already numbered, or removes the numbers if every line has one.
 * Checklist items are left as they are, so they can still be ticked.
 */
export function numberLines(state) {
  const touched = touchedLines(state)
  const numberable = touched.lines.filter((line) => !CHECKLIST.test(line))
  const remove = numberable.length > 0 && numberable.every((line) => NUMBERED.test(line))
  let count = 0
  return replaceLines(
    state,
    touched,
    touched.lines.map((line) => {
      if (CHECKLIST.test(line)) return line
      const bare = line.replace(NUMBERED, '')
      return remove ? bare : `${++count}. ${bare.replace(BULLET, '')}`
    }),
  )
}

/** Turns the selection into `[text](https://)` with the address selected, ready to type. */
export function insertLink({ value, start, end }) {
  const text = value.slice(start, end) || 'link'
  const before = `${value.slice(0, start)}[${text}](`
  return { value: `${before}https://)${value.slice(end)}`, start: before.length, end: before.length + 'https://'.length }
}
