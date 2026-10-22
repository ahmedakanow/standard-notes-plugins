/**
 * Creates an element. Props: `class`, `dataset`, `on<event>` listeners, DOM properties
 * (value, checked, disabled…), and anything else as an attribute. Falsy children are skipped.
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') element.className = value
    else if (key === 'dataset') Object.assign(element.dataset, value)
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value)
    else if (key in element && !key.includes('-')) element[key] = value
    else element.setAttribute(key, value === true ? '' : value)
  }
  element.append(...children.flat(Infinity).filter((child) => child != null && child !== false))
  return element
}

/** Remembers which `data-focus` field had focus, so it can be restored after a re-render. */
export function captureFocus(root) {
  const active = document.activeElement
  if (!active?.dataset?.focus || !root.contains(active)) return null
  return { key: active.dataset.focus, start: active.selectionStart, end: active.selectionEnd }
}

export function restoreFocus(root, focus) {
  const field = focus && root.querySelector(`[data-focus="${focus.key}"]`)
  if (!field || field === document.activeElement) return
  field.focus({ preventScroll: true })
  if (focus.start != null) field.setSelectionRange(focus.start, focus.end)
}

/** Grows a textarea to fit its text without moving the page. */
export function autosize(textarea) {
  const scroller = document.scrollingElement
  const scrollTop = scroller.scrollTop
  const borders = textarea.offsetHeight - textarea.clientHeight
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + borders}px`
  scroller.scrollTop = scrollTop
}
