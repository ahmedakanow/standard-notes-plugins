// The editor for an entry's text: Milkdown (on ProseMirror), bundled in ../vendor. It reads
// and writes the same Markdown the note stores, and keeps the formatting of text pasted from
// Google Docs, Word or a web page: bold, italics, lists and links. On top of Milkdown this
// adds underline (saved as <u>…</u>, since Markdown has none), checklists you can tick,
// images shown as links so opening a note never loads anything from the web, highlighting a
// search match, and a fixed toolbar, which suits a phone better than one that pops up.

import {
  $command,
  $markSchema,
  $prose,
  $remark,
  $view,
  Decoration,
  DecorationSet,
  Editor,
  Plugin,
  PluginKey,
  callCommand,
  clipboard,
  commonmark,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  extendListItemSchemaForTask,
  getMarkdown,
  gfm,
  history,
  imageSchema,
  liftListItemCommand,
  listener,
  listenerCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleMark,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
} from '../vendor/milkdown.js'
import { h } from './dom.js'

const isUnderlined = (dom) => /underline/.test(`${dom.style.textDecoration} ${dom.style.textDecorationLine}`)
const isTag = (node, tag) => node.type === 'html' && node.value.trim().toLowerCase() === tag

/** Turns `<u>`…`</u>` pairs among a node's children (at any depth) into underline nodes. */
function joinUnderlines(node) {
  if (!node.children) return
  node.children.forEach(joinUnderlines)
  const joined = []
  for (const child of node.children) {
    const start = isTag(child, '</u>') ? joined.findLastIndex((other) => isTag(other, '<u>')) : -1
    if (start === -1) {
      joined.push(child)
      continue
    }
    const inside = joined.splice(start)
    joined.push({ type: 'underline', children: inside.slice(1) })
  }
  node.children = joined
}

/** Reads `<u>…</u>` in the Markdown as underline, and writes underline back that way. */
const remarkUnderline = $remark('remarkUnderline', () =>
  function underline() {
    const data = this.data()
    data.toMarkdownExtensions ??= []
    data.toMarkdownExtensions.push({
      handlers: {
        underline: (node, _, state, info) => `<u>${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</u>`,
      },
    })
    return (tree) => joinUnderlines(tree)
  },
)

const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [
    { tag: 'u' },
    // Google Docs underlines with a style. Links there are underlined too, but that's just
    // how links look, so it isn't kept on them.
    { tag: 'span', consuming: false, getAttrs: (dom) => (isUnderlined(dom) && !dom.closest('a') ? null : false) },
  ],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () => toggleMark(underlineSchema.type(ctx)))

/** Images show as their description, so nothing is loaded from the web. */
const imageAsText = imageSchema.extendSchema((previous) => (ctx) => ({
  ...previous(ctx),
  toDOM: (node) => ['span', { class: 'md-image', title: node.attrs.src }, `🖼 ${node.attrs.alt || 'image'}`],
}))

/** New lists are tight (no blank line between items), like lists pasted or typed by hand. */
const listItem = extendListItemSchemaForTask.extendSchema((previous) => (ctx) => {
  const schema = previous(ctx)
  return { ...schema, attrs: { ...schema.attrs, spread: { ...schema.attrs.spread, default: false } } }
})

/** List items, with a real checkbox for checklist items. */
const listItemView = $view(listItem.node, () => (node, view, getPos) => {
  const dom = document.createElement('li')
  const contentDOM = document.createElement('div')
  dom.append(contentDOM)
  let box = null
  const show = (current) => {
    dom.dataset.listType = current.attrs.listType
    if (current.attrs.checked == null) {
      box?.remove()
      box = null
      delete dom.dataset.itemType
      return
    }
    dom.dataset.itemType = 'task'
    if (!box) {
      box = h('input', {
        type: 'checkbox',
        class: 'md-box',
        'aria-label': 'Checklist item',
        contentEditable: 'false',
        onchange: () => {
          const pos = getPos()
          if (pos == null) return
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: box.checked }))
        },
      })
      dom.prepend(box)
    }
    box.checked = current.attrs.checked
    box.disabled = !view.editable
  }
  show(node)
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== node.type) return false
      node = next
      show(next)
      return true
    },
    stopEvent: (event) => event.target === box,
    ignoreMutation: (mutation) => mutation.target === box || (mutation.type === 'attributes' && mutation.target === dom),
  }
})

const highlightKey = new PluginKey('highlight')

/** Marks every match of `term` until the text is changed. */
const highlight = (term) =>
  $prose(
    () =>
      new Plugin({
        key: highlightKey,
        state: {
          init: (_, { doc }) => (term ? DecorationSet.create(doc, matches(doc, term)) : DecorationSet.empty),
          apply: (tr, set) => (tr.docChanged ? DecorationSet.empty : set),
        },
        props: { decorations: (state) => highlightKey.getState(state) },
      }),
  )

function matches(doc, term) {
  const needle = term.toLowerCase()
  const found = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text.toLowerCase()
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
      found.push(Decoration.inline(pos + at, pos + at + needle.length, { nodeName: 'mark' }))
    }
  })
  return found
}

/** Marks the text as empty, so CSS can show what to do. */
const emptyHint = $prose(
  () =>
    new Plugin({
      props: {
        attributes: (state) => {
          const only = state.doc.childCount === 1 ? state.doc.firstChild : null
          return only?.isTextblock && only.content.size === 0 ? { class: 'is-empty' } : {}
        },
      },
    }),
)

/**
 * A tap on a link opens it, unless you're already typing in the text, where a tap just puts
 * the cursor there.
 */
const openLinks = $prose(() => {
  let wasTyping = false
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view) => {
          wasTyping = view.editable && view.hasFocus()
          return false
        },
        click: (view, event) => {
          const link = event.target.closest?.('a[href]')
          if (!link || wasTyping) return false
          event.preventDefault()
          window.open(link.href, '_blank', 'noopener')
          return true
        },
      },
    },
  })
})

/** The list item the cursor is in, and its list: { item, itemPos, list, listPos }, or null. */
function listAround(state) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 1; depth--) {
    if ($from.node(depth).type.name !== 'list_item') continue
    return { item: $from.node(depth), itemPos: $from.before(depth), list: $from.node(depth - 1), listPos: $from.before(depth - 1) }
  }
  return null
}

/** The list items the selection touches, or the one the cursor is in. */
function itemsInSelection(state) {
  const items = []
  const { from, to } = state.selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'list_item') items.push({ node, pos })
  })
  const around = listAround(state)
  return items.length ? items : around ? [{ node: around.item, pos: around.itemPos }] : []
}

/** Makes the list the cursor is in a bulleted or numbered one. */
function retypeList(view, ordered) {
  const { state } = view
  const { list, listPos } = listAround(state)
  const type = state.schema.nodes[ordered ? 'ordered_list' : 'bullet_list']
  const tr = state.tr.setNodeMarkup(listPos, type, ordered ? { order: 1, spread: list.attrs.spread } : { spread: list.attrs.spread })
  let pos = listPos + 1
  list.forEach((item, _, index) => {
    tr.setNodeMarkup(pos, undefined, { ...item.attrs, listType: ordered ? 'ordered' : 'bullet', label: ordered ? `${index + 1}.` : '•' })
    pos += item.nodeSize
  })
  view.dispatch(tr)
}

/** Where the link around the cursor starts and ends, or null. */
function linkExtent(state, link) {
  const { $from } = state.selection
  let pos = $from.start()
  let runStart = null
  let found = null
  const close = (end) => {
    if (runStart !== null && runStart <= $from.pos && $from.pos <= end) found = { from: runStart, to: end }
    runStart = null
  }
  $from.parent.forEach((child) => {
    if (link.isInSet(child.marks)) runStart ??= pos
    else close(pos)
    pos += child.nodeSize
  })
  close(pos)
  return found
}

function setChecked(view, checked) {
  const { state } = view
  const tr = state.tr
  for (const { node, pos } of itemsInSelection(state)) tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
  view.dispatch(tr)
}

/**
 * Puts an editor for `markdown` in `host`: a toolbar, then the text. `onChange(markdown)` is
 * called as you type, only for real changes: opening an entry never re-saves it. Returns
 * { ready, focus, hasFocus, flush, destroy }; `flush` hands over typing not yet reported.
 */
export function mountEntryEditor(host, { markdown, editable, highlight: term = '', onChange }) {
  const surface = h('div', { class: 'md nb-editor' })
  let view = null
  let known = null // the Markdown as loaded, or as last handed to onChange
  const current = () => editor.action(getMarkdown()).replace(/\s+$/, '') // without Milkdown's closing newline
  const report = (next) => {
    if (next === known) return
    known = next
    onChange(next)
  }
  const run = (fn) => {
    if (!view) return
    fn(view)
    view.focus()
  }
  const command = (key, payload) => run(() => editor.action(callCommand(key, payload)))
  const isList = (ordered) => listAround(view.state)?.list.type.name === (ordered ? 'ordered_list' : 'bullet_list')

  const toggleList = (ordered) =>
    run(() => {
      const around = listAround(view.state)
      if (!around) command(ordered ? wrapInOrderedListCommand.key : wrapInBulletListCommand.key)
      else if (isList(ordered) && around.item.attrs.checked == null) command(liftListItemCommand.key)
      else if (around.item.attrs.checked != null && !ordered) setChecked(view, null)
      else retypeList(view, ordered)
    })

  const toggleChecklist = () =>
    run(() => {
      const around = listAround(view.state)
      if (around && around.item.attrs.checked != null) return setChecked(view, null)
      if (!around) editor.action(callCommand(wrapInBulletListCommand.key))
      setChecked(view, false)
    })

  // The link button asks for an address in the toolbar: the plugin can't show dialogs.
  const linkField = h('input', {
    type: 'url',
    class: 'field nb-link-field',
    placeholder: 'Paste the link address',
    'aria-label': 'Link address',
    enterkeyhint: 'done',
    onkeydown: (event) => {
      if (event.key === 'Escape') closeLink()
      if (event.key !== 'Enter') return
      event.preventDefault()
      addLink()
    },
  })
  const linkRow = h(
    'div',
    { class: 'nb-link-row', hidden: true },
    linkField,
    h('button', { type: 'button', class: 'button primary', onclick: () => addLink() }, 'Add link'),
    h('button', { type: 'button', class: 'text-button', onclick: () => closeLink() }, 'Cancel'),
  )
  const closeLink = () => {
    linkRow.hidden = true
    linkField.value = ''
    view?.focus()
  }
  function addLink() {
    const href = linkField.value.trim()
    if (!href) return closeLink()
    const { state } = view
    if (state.selection.empty) {
      const mark = state.schema.marks.link.create({ href })
      view.dispatch(state.tr.insert(state.selection.from, state.schema.text(href, [mark])))
    } else {
      editor.action(callCommand(toggleLinkCommand.key, { href }))
    }
    closeLink()
  }
  /** Takes the link off if there is one at the cursor or in the selection, or asks for an address. */
  const toggleLink = () => {
    const { state } = view
    const { from, to, empty } = state.selection
    const link = state.schema.marks.link
    const range = empty ? linkExtent(state, link) : state.doc.rangeHasMark(from, to, link) && { from, to }
    if (range) return run(() => view.dispatch(state.tr.removeMark(range.from, range.to, link)))
    linkRow.hidden = false
    linkField.focus()
  }

  const tool = (label, name, action) =>
    h(
      'button',
      {
        type: 'button',
        class: 'tool',
        'aria-label': name,
        title: name,
        onpointerdown: (event) => event.preventDefault(), // keeps the selection in the text
        onclick: () => view && action(),
      },
      label,
    )
  const toolbar = h(
    'div',
    { class: 'nb-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
    tool('B', 'Bold', () => command(toggleStrongCommand.key)),
    tool('I', 'Italic', () => command(toggleEmphasisCommand.key)),
    tool('U', 'Underline', () => command(toggleUnderlineCommand.key)),
    tool('•', 'Bulleted list', () => toggleList(false)),
    tool('1.', 'Numbered list', () => toggleList(true)),
    tool('☐', 'Checklist', toggleChecklist),
    tool('🔗', 'Link', toggleLink),
  )
  host.replaceChildren(...(editable ? [toolbar, linkRow] : []), surface)

  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, surface)
      ctx.set(defaultValueCtx, markdown)
      ctx.update(editorViewOptionsCtx, (options) => ({ ...options, editable: () => editable }))
      // `-` bullets and `_` italics, as typed by hand, so the plain text stays familiar.
      ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-', emphasis: '_' }))
      ctx.get(listenerCtx).markdownUpdated((_, next) => report(next.replace(/\s+$/, '')))
    })
    .use(commonmark)
    .use(gfm)
    .use([remarkUnderline, underlineSchema, toggleUnderlineCommand].flat())
    .use(imageAsText)
    .use(listItem)
    .use(listItemView)
    .use(highlight(term))
    .use(emptyHint)
    .use(openLinks)
    .use(history)
    .use(listener)
    .use(clipboard)
  const ready = editor.create().then(() => {
    view = editor.ctx.get(editorViewCtx)
    known = current()
    return view
  })

  return {
    ready,
    focus: () => view?.focus(),
    hasFocus: () => Boolean(view?.hasFocus()),
    // Milkdown reports typing after a short pause; this takes what's there now.
    flush: () => view && report(current()),
    destroy: () => ready.then(() => editor.destroy()),
  }
}
