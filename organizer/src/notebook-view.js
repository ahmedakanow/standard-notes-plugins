import { shortDate } from './dates.js'
import { autosize, captureFocus, h, restoreFocus } from './dom.js'
import { insertLink, numberLines, prefixLines, wrap } from './editing.js'
import { plainPreview, renderMarkdown } from './markdown.js'
import {
  MAX_DEPTH,
  addEntry,
  addSection,
  countInside,
  deleteSection,
  entryTargets,
  locate,
  locateEntry,
  moveEntry,
  moveEntryByOne,
  moveSection,
  moveSectionByOne,
  moveTargets,
  pathTo,
  removeEntry,
  renameEntry,
  renameSection,
  reorderEntry,
  reorderSection,
  searchNotebook,
  setEntryText,
  toggleCheck,
} from './notebook.js'

// Every save re-uploads the whole note, so typing saves after a pause, not per keystroke.
const TYPING_SAVE_MS = 2000
const DELETE_CONFIRM_MS = 3000
const WIDE = '(min-width: 760px)'

/**
 * Renders a Notebook note into `root`. `session` gives the model, the note's title, the
 * context ({ today }), whether the note is read-only, and `save()`. Sections and entries
 * share one id space, so `ui` refers to either by id.
 */
export function mountNotebook(root, session) {
  const ui = {
    current: null, // id of the open section or entry, or null for the front page
    editing: false, // the open entry's text is being edited
    query: '',
    highlight: '', // search term to mark in the entry opened from a result
    arranging: false, // the contents show drag handles and menus instead of reading view
    menu: null, // id of the section or entry whose ⋯ menu is open
    moving: null, // id of the section or entry choosing where to move
    renaming: null,
    renameDraft: null,
    confirmDelete: null,
    adding: null, // { kind: 'entry' | 'section', place: 'top' | section id } while a name box is open
    addDraft: '',
    expanded: new Set(), // sections opened in the side tree
    focusTarget: null, // data-focus key to focus after the next render
  }
  const wide = window.matchMedia(WIDE)
  const body = h('div', { class: 'notebook' })
  let saveTimer = 0
  let rendering = false
  root.replaceChildren(body)

  function saveSoon() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = 0
      session.save()
    }, TYPING_SAVE_MS)
  }

  /** Saves straight away if typing left a save waiting. */
  function flush() {
    if (!saveTimer) return
    clearTimeout(saveTimer)
    saveTimer = 0
    session.save()
  }

  function commit() {
    clearTimeout(saveTimer)
    saveTimer = 0
    session.save()
    render()
  }

  const rootTitle = () => session.title || 'Notebook'

  /** What `id` is: { kind: 'section', section, parent, depth, … } or { kind: 'entry', entry, section, … }. */
  function find(id) {
    const place = locate(session.model, id)
    if (place) return { kind: 'section', ...place }
    const found = locateEntry(session.model, id)
    return found && { kind: 'entry', ...found }
  }

  function open(id, { highlight = '' } = {}) {
    Object.assign(ui, {
      current: id,
      editing: false,
      arranging: false,
      menu: null,
      moving: null,
      renaming: null,
      confirmDelete: null,
      adding: null,
      highlight,
    })
    render()
    const match = highlight && root.querySelector('.nb-page mark')
    if (match) match.scrollIntoView({ block: 'center' })
    else document.scrollingElement.scrollTop = 0
  }

  function render() {
    if (!root.contains(body)) return // another note or template has replaced this view
    const focus = captureFocus(root)
    const ctx = session.context()
    if (ui.current !== null && !find(ui.current)) ui.current = null
    const main = ui.query.trim() ? searchResults() : pagePane(ctx)
    rendering = true
    body.replaceChildren(topBar(), wide.matches ? h('div', { class: 'nb-columns' }, treePane(), main) : main)
    rendering = false
    body.querySelectorAll('textarea').forEach(autosize)
    // data-disabled marks controls that are off for their own reasons; data-always ones stay on when locked.
    for (const control of body.querySelectorAll('input, textarea, button, select')) {
      if (!('always' in control.dataset)) control.disabled = session.readOnly || 'disabled' in control.dataset
    }
    restoreFocus(root, focus)
    if (ui.focusTarget) {
      root.querySelector(`[data-focus="${CSS.escape(ui.focusTarget)}"]`)?.focus()
      ui.focusTarget = null
    }
  }

  /** Splits `text` around case-insensitive matches of `term`, marking each match. */
  function mark(text, term) {
    const needle = term.trim().toLowerCase()
    if (!needle) return [text]
    const lower = text.toLowerCase()
    const parts = []
    let from = 0
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
      if (at > from) parts.push(text.slice(from, at))
      parts.push(h('mark', {}, text.slice(at, at + needle.length)))
      from = at + needle.length
    }
    if (from < text.length) parts.push(text.slice(from))
    return parts
  }

  /** Builds DOM from renderMarkdown's tree. Text only ever goes in as text, never as HTML. */
  function toDom(node, entryId) {
    if (typeof node === 'string') return mark(node, ui.highlight)
    const props = { ...node.props }
    if (node.tag === 'input') {
      props['aria-label'] = 'Checklist item'
      if (props.disabled) props['data-disabled'] = true
      if (props.dataset) {
        const n = Number(props.dataset.check)
        props.onchange = () => {
          toggleCheck(session.model, entryId, n, session.context().today)
          commit()
        }
      }
    }
    const children = (node.children ?? []).map((child) => toDom(child, entryId))
    // The whole checklist line ticks the box, which is easier to hit on a phone.
    if (node.tag === 'li' && props.class === 'md-check') return h('li', props, h('label', {}, children))
    return h(node.tag, props, children)
  }

  function topBar() {
    return h(
      'div',
      { class: 'nb-topbar' },
      h('input', {
        type: 'search',
        class: 'nb-search',
        placeholder: 'Search this notebook',
        'aria-label': 'Search this notebook',
        value: ui.query,
        'data-focus': 'search',
        'data-always': '',
        oninput: (event) => {
          ui.query = event.target.value
          render()
        },
      }),
      session.readOnly && h('span', { class: 'lock-badge' }, '🔒 Locked'),
    )
  }

  function searchResults() {
    const results = searchNotebook(session.model, ui.query)
    return h(
      'section',
      { class: 'nb-page', 'aria-label': 'Search results' },
      h('p', { class: 'meta' }, results.length === 0 ? 'Nothing found.' : `${results.length} found`),
      h(
        'ul',
        { class: 'nb-list' },
        results.map((result) =>
          h(
            'li',
            { class: 'nb-row is-result' },
            h(
              'button',
              {
                type: 'button',
                class: 'nb-open',
                'data-always': '',
                onclick: () => {
                  const term = ui.query.trim()
                  ui.query = ''
                  open(result.id, { highlight: term })
                },
              },
              h('span', { class: `nb-row-title is-${result.kind}` }, mark(result.title, ui.query)),
              result.path.length > 0 && h('span', { class: 'meta' }, result.path.join(' › ')),
              result.snippet && h('span', { class: 'nb-preview' }, mark(result.snippet, ui.query)),
            ),
          ),
        ),
      ),
    )
  }

  /** On wide screens, everything in the notebook as a tree beside the page. */
  function treePane() {
    const current = ui.current === null ? null : find(ui.current)
    const sectionId = current?.section?.id ?? null // the open section, or the open entry's
    const onPath = new Set(sectionId === null ? [] : pathTo(session.model, sectionId).map((section) => section.id))
    const link = (item, isEntry) =>
      h(
        'button',
        {
          type: 'button',
          class: `nb-tree-link${isEntry ? ' is-entry' : ''}`,
          'aria-current': item.id === ui.current ? 'page' : null,
          'data-always': '',
          onclick: () => open(item.id),
        },
        item.title,
      )
    const leaf = (entry) =>
      h(
        'li',
        {},
        h(
          'div',
          { class: `nb-tree-row${entry.id === ui.current ? ' is-current' : ''}` },
          h('span', { class: 'nb-tree-caret', 'aria-hidden': 'true' }),
          link(entry, true),
        ),
      )
    const node = (section) => {
      const isOpen = ui.expanded.has(section.id) || onPath.has(section.id)
      const hasInside = section.children.length + section.entries.length > 0
      return h(
        'li',
        {},
        h(
          'div',
          { class: `nb-tree-row${section.id === ui.current ? ' is-current' : ''}` },
          hasInside
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'nb-tree-caret',
                  'aria-label': `${isOpen ? 'Collapse' : 'Expand'} ${section.title}`,
                  'aria-expanded': String(isOpen),
                  'data-always': '',
                  onclick: () => {
                    if (isOpen) ui.expanded.delete(section.id)
                    else ui.expanded.add(section.id)
                    render()
                  },
                },
                isOpen ? '▾' : '▸',
              )
            : h('span', { class: 'nb-tree-caret', 'aria-hidden': 'true' }),
          link(section, false),
        ),
        isOpen && hasInside && h('ul', {}, section.children.map(node), section.entries.map(leaf)),
      )
    }
    return h(
      'nav',
      { class: 'nb-tree', 'aria-label': 'Everything in this notebook' },
      h(
        'button',
        {
          type: 'button',
          class: `nb-tree-root${ui.current === null ? ' is-current' : ''}`,
          'data-always': '',
          onclick: () => open(null),
        },
        rootTitle(),
      ),
      h('ul', {}, session.model.sections.map(node), session.model.entries.map(leaf)),
    )
  }

  function pagePane(ctx) {
    if (ui.current === null) return sectionPage(null, 0, ctx)
    const found = find(ui.current)
    return found.kind === 'entry' ? entryPage(found, ctx) : sectionPage(found.section, found.depth, ctx)
  }

  /**
   * A section, or the front page (`section` null), which has no title: Standard Notes
   * already shows the note's name above it. Add entry and Add section come first, then
   * what's inside.
   */
  function sectionPage(section, depth, ctx) {
    const sections = section ? section.children : session.model.sections
    const entries = section ? section.entries : session.model.entries
    return h(
      'section',
      { class: 'nb-page', 'aria-label': section?.title ?? rootTitle() },
      section && [
        breadcrumb(pathTo(session.model, section.id).slice(0, -1)),
        titleRow(section, ctx),
        section.edited && h('p', { class: 'meta nb-edited' }, `Edited ${shortDate(section.edited, ctx.today)}`),
        ui.menu === section.id && itemMenu(section, false, ctx),
        ui.moving === section.id && movePicker(section, false, ctx),
      ],
      addRow(section?.id ?? null, depth, sections.length + entries.length > 0, ctx),
      contentsBlock(sections, entries, ctx),
    )
  }

  /** An entry: its name, then its text to read, tick and edit. */
  function entryPage({ entry, section }, ctx) {
    return h(
      'article',
      { class: 'nb-page', 'aria-label': entry.title },
      breadcrumb(section ? pathTo(session.model, section.id) : []),
      titleRow(entry, ctx),
      entry.edited && h('p', { class: 'meta nb-edited' }, `Edited ${shortDate(entry.edited, ctx.today)}`),
      ui.menu === entry.id && itemMenu(entry, true, ctx),
      ui.moving === entry.id && movePicker(entry, true, ctx),
      ui.editing
        ? editor(entry, ctx)
        : h(
            'div',
            { class: 'nb-text' },
            entry.text &&
              h(
                'div',
                { class: 'md' },
                renderMarkdown(entry.text).map((node) => toDom(node, entry.id)),
              ),
            h(
              'button',
              { type: 'button', class: 'text-button', onclick: () => startEditing(entry) },
              entry.text ? 'Edit' : 'Add text',
            ),
          ),
    )
  }

  /** The way back up: the front page, then each section above. */
  function breadcrumb(sections) {
    const crumb = (label, id) =>
      h('button', { type: 'button', class: 'crumb', 'data-always': '', onclick: () => open(id) }, label)
    return h(
      'nav',
      { class: 'nb-crumbs', 'aria-label': 'Where you are' },
      crumb(rootTitle(), null),
      sections.map((section) => [h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'), crumb(section.title, section.id)]),
    )
  }

  function titleRow(item, ctx) {
    return h(
      'div',
      { class: 'nb-title-row' },
      ui.renaming === item.id ? renameInput(item, ctx) : h('h1', { class: 'nb-title' }, item.title),
      moreButton(item),
    )
  }

  /**
   * + Add entry and + Add section, each asking for a name and adding it at the end, and
   * Arrange when there's something to arrange.
   */
  function addRow(sectionId, depth, canArrange, ctx) {
    const place = sectionId ?? 'top'
    if (ui.adding?.place === place) return nameForm(sectionId, ui.adding.kind, ctx)
    const start = (kind) => () => {
      Object.assign(ui, { adding: { kind, place }, addDraft: '', focusTarget: `add-${place}` })
      render()
    }
    return h(
      'div',
      { class: 'nb-add-row' },
      h('button', { type: 'button', class: 'text-button', onclick: start('entry') }, '+ Add entry'),
      depth < MAX_DEPTH && h('button', { type: 'button', class: 'text-button', onclick: start('section') }, '+ Add section'),
      canArrange &&
        h(
          'button',
          {
            type: 'button',
            class: 'text-button',
            'aria-pressed': String(ui.arranging),
            onclick: () => {
              ui.arranging = !ui.arranging
              ui.menu = null
              ui.moving = null
              render()
            },
          },
          ui.arranging ? 'Done arranging' : 'Arrange',
        ),
    )
  }

  function nameForm(sectionId, kind, ctx) {
    const add = () => {
      const item =
        kind === 'entry'
          ? addEntry(session.model, sectionId, ui.addDraft, ctx.today)
          : addSection(session.model, sectionId, ui.addDraft, ctx.today)
      if (!item) return
      ui.adding = null
      ui.addDraft = ''
      commit()
      root.querySelector(`[data-item="${item.id}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    const cancel = () => {
      ui.adding = null
      render()
    }
    return h(
      'div',
      { class: 'nb-add' },
      h('input', {
        type: 'text',
        class: 'field',
        placeholder: kind === 'entry' ? 'Entry name' : 'Section name',
        'aria-label': kind === 'entry' ? 'New entry name' : 'New section name',
        enterkeyhint: 'done',
        value: ui.addDraft,
        'data-focus': `add-${sectionId ?? 'top'}`,
        oninput: (event) => {
          ui.addDraft = event.target.value
        },
        onkeydown: (event) => {
          if (event.key === 'Escape') cancel()
          if (event.key !== 'Enter' || event.isComposing) return
          event.preventDefault()
          add()
        },
      }),
      h(
        'div',
        { class: 'button-row' },
        h('button', { type: 'button', class: 'button primary', onclick: add }, kind === 'entry' ? 'Add entry' : 'Add section'),
        h('button', { type: 'button', class: 'text-button', onclick: cancel }, 'Cancel'),
      ),
    )
  }

  /**
   * What's in a page, like a book's contents: sections first, with what's inside them
   * indented underneath, then entries with their first line. When each was last edited
   * sits at the right. Arrange (beside the add buttons) swaps it for handles and menus.
   */
  function contentsBlock(sections, entries, ctx) {
    if (sections.length + entries.length === 0) return null
    return h(
      'section',
      { class: 'nb-contents', 'aria-label': 'Contents' },
      ui.arranging
        ? [sections.length > 0 && rowList(sections, false, ctx), entries.length > 0 && rowList(entries, true, ctx)]
        : h(
            'ul',
            { class: 'toc' },
            sections.map((section) => tocSection(section, 1, ctx)),
            entries.map((entry) => tocEntry(entry, 1, ctx)),
          ),
    )
  }

  const tocLink = (item, ctx) =>
    h(
      'button',
      { type: 'button', class: 'toc-entry', 'data-always': '', onclick: () => open(item.id) },
      h('span', { class: 'toc-title' }, item.title),
      item.edited && h('span', { class: 'toc-meta' }, shortDate(item.edited, ctx.today)),
    )

  function tocSection(section, level, ctx) {
    const hasInside = section.children.length + section.entries.length > 0
    const deeper = level === 2 ? countInside(section) : 0
    return h(
      'li',
      { class: `toc-item level-${level} is-section`, 'data-item': section.id },
      tocLink(section, ctx),
      level === 1 &&
        hasInside &&
        h(
          'ul',
          { class: 'toc' },
          section.children.map((child) => tocSection(child, 2, ctx)),
          section.entries.map((entry) => tocEntry(entry, 2, ctx)),
        ),
      deeper > 0 && h('p', { class: 'toc-more' }, `and ${deeper} more inside`),
    )
  }

  function tocEntry(entry, level, ctx) {
    const preview = level === 1 && plainPreview(entry.text)
    return h(
      'li',
      { class: `toc-item level-${level} is-entry`, 'data-item': entry.id },
      tocLink(entry, ctx),
      preview && h('p', { class: 'toc-preview' }, h('span', { class: 'toc-preview-text' }, preview)),
    )
  }

  /** Arrange mode: rows with a drag handle, the name and a ⋯ menu. */
  const rowList = (items, isEntry, ctx) =>
    h(
      'ul',
      { class: 'nb-list' },
      items.map((item) =>
        h(
          'li',
          { class: 'nb-row', dataset: { id: item.id } },
          dragHandle(item, isEntry),
          h(
            'button',
            { type: 'button', class: 'nb-open', 'data-always': '', onclick: () => open(item.id) },
            h('span', { class: `nb-row-title is-${isEntry ? 'entry' : 'section'}` }, item.title),
          ),
          moreButton(item),
          ui.menu === item.id && itemMenu(item, isEntry, ctx),
          ui.moving === item.id && movePicker(item, isEntry, ctx),
        ),
      ),
    )

  const moreButton = (item) =>
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': `More actions for ${item.title}`,
        'aria-expanded': String(ui.menu === item.id),
        onclick: () => {
          ui.menu = ui.menu === item.id ? null : item.id
          ui.moving = null
          ui.confirmDelete = null
          render()
        },
      },
      '⋯',
    )

  /** Rename, Move… and Delete (two taps) for a section or an entry. */
  function itemMenu(item, isEntry, ctx) {
    const confirming = ui.confirmDelete === item.id
    const inside = isEntry ? 0 : countInside(item)
    const button = (text, onclick, props = {}) => h('button', { type: 'button', class: 'button', onclick, ...props }, text)
    return h(
      'div',
      { class: 'button-row nb-menu' },
      button('Rename', () => {
        if (ui.current !== item.id) open(item.id)
        Object.assign(ui, { renaming: item.id, renameDraft: null, menu: null, focusTarget: `rename-${item.id}` })
        render()
      }),
      button('Move…', () => {
        ui.moving = ui.moving === item.id ? null : item.id
        render()
      }),
      button(
        confirming ? `Tap again to delete${inside ? ` it and ${inside} inside` : ''}` : 'Delete',
        () => {
          if (!confirming) {
            ui.confirmDelete = item.id
            render()
            setTimeout(() => {
              if (ui.confirmDelete !== item.id) return
              ui.confirmDelete = null
              render()
            }, DELETE_CONFIRM_MS)
            return
          }
          const found = find(item.id)
          const above = (isEntry ? found.section : found.parent)?.id ?? null
          if (isEntry) removeEntry(session.model, item.id, ctx.today)
          else deleteSection(session.model, item.id)
          if (ui.current === item.id) ui.current = above
          ui.menu = null
          ui.confirmDelete = null
          commit()
        },
        { class: `button danger${confirming ? ' is-confirming' : ''}` },
      ),
    )
  }

  /** Where a section or an entry can move, indented by depth. A null title is the front page. */
  function movePicker(item, isEntry, ctx) {
    const targets = isEntry ? entryTargets(session.model, item.id) : moveTargets(session.model, item.id)
    const close = () => {
      ui.moving = null
      ui.menu = null
    }
    return h(
      'div',
      { class: 'nb-move' },
      h('p', { class: 'meta' }, targets.length ? `Move "${item.title}" into:` : 'There is nowhere else it can go yet.'),
      h(
        'ul',
        { class: 'nb-move-list' },
        targets.map((target) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: 'nb-move-target',
                style: `padding-left: ${0.75 + target.depth}rem`,
                onclick: () => {
                  if (isEntry) moveEntry(session.model, item.id, target.id, ctx.today)
                  else moveSection(session.model, item.id, target.id)
                  close()
                  commit()
                },
              },
              target.title ?? rootTitle(),
            ),
          ),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          onclick: () => {
            ui.moving = null
            render()
          },
        },
        'Cancel',
      ),
    )
  }

  function renameInput(item, ctx) {
    const isEntry = Boolean(locateEntry(session.model, item.id))
    const finish = (value) => {
      if (ui.renaming !== item.id) return
      if (value !== null) (isEntry ? renameEntry : renameSection)(session.model, item.id, value, ctx.today)
      ui.renaming = null
      ui.renameDraft = null
      if (value !== null) commit()
      else render()
    }
    return h('input', {
      type: 'text',
      class: 'field nb-rename',
      value: ui.renameDraft ?? item.title,
      'aria-label': `New name for ${item.title}`,
      enterkeyhint: 'done',
      'data-focus': `rename-${item.id}`,
      oninput: (event) => {
        ui.renameDraft = event.target.value
      },
      onkeydown: (event) => {
        if (event.key === 'Escape') finish(null)
        if (event.key !== 'Enter') return
        event.preventDefault()
        finish(event.target.value)
      },
      // Chrome blurs a focused element when a re-render removes it; that isn't the user leaving.
      onblur: (event) => rendering || finish(event.target.value),
    })
  }

  function startEditing(entry) {
    ui.editing = true
    ui.focusTarget = `edit-${entry.id}`
    render()
  }

  function editor(entry, ctx) {
    const update = (value) => {
      setEntryText(session.model, entry.id, value, ctx.today)
      saveSoon()
    }
    const textarea = h('textarea', {
      class: 'nb-editor',
      rows: 6,
      value: entry.text,
      'aria-label': `Text of ${entry.title}`,
      'data-focus': `edit-${entry.id}`,
      oninput: (event) => {
        autosize(event.target)
        update(event.target.value)
      },
    })
    const tool = (label, name, apply) =>
      h(
        'button',
        {
          type: 'button',
          class: 'tool',
          'aria-label': name,
          title: name,
          onpointerdown: (event) => event.preventDefault(), // keeps the selection in the text box
          onclick: () => {
            const next = apply({ value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd })
            textarea.value = next.value
            textarea.focus()
            textarea.setSelectionRange(next.start, next.end)
            autosize(textarea)
            update(next.value)
          },
        },
        label,
      )
    return h(
      'div',
      { class: 'nb-editor-wrap' },
      h(
        'div',
        { class: 'nb-toolbar', role: 'toolbar', 'aria-label': 'Formatting' },
        tool('B', 'Bold', (state) => wrap(state, '**')),
        tool('I', 'Italic', (state) => wrap(state, '_')),
        tool('U', 'Underline', (state) => wrap(state, '<u>', '</u>')),
        tool('•', 'Bulleted list', (state) => prefixLines(state, '- ')),
        tool('1.', 'Numbered list', numberLines),
        tool('☐', 'Checklist', (state) => prefixLines(state, '- [ ] ')),
        tool('🔗', 'Link', insertLink),
      ),
      textarea,
      h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'button primary',
            onclick: () => {
              ui.editing = false
              commit()
            },
          },
          'Done',
        ),
      ),
    )
  }

  function dragHandle(item, isEntry) {
    return h(
      'button',
      {
        type: 'button',
        class: 'drag-handle',
        'aria-label': `Move ${item.title}: drag, or use the arrow keys`,
        'data-focus': `handle-${item.id}`,
        onpointerdown: (event) => startDrag(event, item, isEntry),
        onkeydown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const step = event.key === 'ArrowUp' ? -1 : 1
          if ((isEntry ? moveEntryByOne : moveSectionByOne)(session.model, item.id, step)) commit()
        },
      },
      '⠿',
    )
  }

  /** Drags a row among its own list by its handle (mouse or touch). Move… changes where it lives. */
  function startDrag(event, item, isEntry) {
    if (session.readOnly || event.button > 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const row = handle.closest('.nb-row')
    const list = row.parentElement
    handle.setPointerCapture(event.pointerId)
    row.classList.add('is-dragging')
    document.body.classList.add('is-dragging-todo')
    const indicator = h('li', { class: 'drop-indicator', 'aria-hidden': 'true' })
    let target // undefined until the pointer moves; then the row to drop before, or null for the end

    const onMove = (moveEvent) => {
      const rows = [...list.children].filter((child) => child.matches('.nb-row') && child !== row)
      target =
        rows.find((candidate) => {
          const box = candidate.getBoundingClientRect()
          return moveEvent.clientY < box.top + box.height / 2
        }) ?? null
      list.insertBefore(indicator, target)
    }
    const finish = (drop) => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onCancel)
      document.body.classList.remove('is-dragging-todo')
      indicator.remove()
      if (!drop || target === undefined) return render()
      const beforeId = target ? Number(target.dataset.id) : null
      ;(isEntry ? reorderEntry : reorderSection)(session.model, item.id, beforeId)
      commit()
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
  }

  wide.addEventListener('change', render)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  window.addEventListener('pagehide', flush)

  render()
  return { update: render, flush }
}
