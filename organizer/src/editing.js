// The Notebook editor's toolbar. Each action takes a textarea's { value, start, end } and
// returns the new { value, start, end }, so they can be tested without a browser.

/** Wraps the selection in a marker such as `**`, selecting the wrapped text. */
export function wrap({ value, start, end }, marker) {
  const selected = value.slice(start, end) || 'text'
  return {
    value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    start: start + marker.length,
    end: start + marker.length + selected.length,
  }
}

/**
 * Adds a prefix such as `- ` to every line the selection touches, or removes it if all of
 * them already have it.
 */
export function prefixLines({ value, start, end }, prefix) {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', Math.max(end - (end > start && value[end - 1] === '\n' ? 1 : 0), start))
  const to = lineEnd === -1 ? value.length : lineEnd
  const lines = value.slice(from, to).split('\n')
  const remove = lines.every((line) => line.startsWith(prefix))
  const changed = lines.map((line) => (remove ? line.slice(prefix.length) : `${prefix}${line}`)).join('\n')
  const next = `${value.slice(0, from)}${changed}${value.slice(to)}`
  if (lines.length === 1) {
    const shift = remove ? -prefix.length : prefix.length
    return { value: next, start: Math.max(from, start + shift), end: Math.max(from, end + shift) }
  }
  return { value: next, start: from, end: from + changed.length }
}

/** Turns the selection into `[text](https://)` with the address selected, ready to type. */
export function insertLink({ value, start, end }) {
  const text = value.slice(start, end) || 'link'
  const before = `${value.slice(0, start)}[${text}](`
  return { value: `${before}https://)${value.slice(end)}`, start: before.length, end: before.length + 'https://'.length }
}
