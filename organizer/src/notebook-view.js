import { shortDate } from './dates.js'
import { autosize, captureFocus, h, restoreFocus } from './dom.js'
import { insertLink, prefixLines, wrap } from './editing.js'
import { plainPreview, renderMarkdown } from './markdown.js'
import {
  MAX_DEPTH,
  addSection,
  addThought,
  countInside,
  deleteSection,
  findUnsorted,
  locate,
  moveSection,
  moveSectionByOne,
  moveTargets,
  pathTo,
  renameSection,
  reorderSection,
  searchNotebook,
  setSectionText,
  toggleCheck,
} from './notebook.js'

// Every save re-uploads the whole note, so typing saves after a pause, not per keystroke.
const TYPING_SAVE_MS = 2000
const DELETE_CONFIRM_MS = 3000
const WIDE = '(min-width: 760px)'

/**
 * Renders a Notebook note into `root`. `session` gives the model, the note's title, the
 * context ({ today }), whether the note is read-only, and `save()`.
 */
export function mountNotebook(root, session) {
  const ui = {
    current: null, // id of the open section, or null for the top level
    editing: null, // id of the section whose text is open for editing, or 'intro'
    query: '',
    highlight: '', // search term to mark in the section opened from a result
    arranging: false, // the contents list shows drag handles and menus instead of reading view
    menu: null, // id of the section whose ⋯ menu is open
    moving: null, // id of the section choosing where to move (or to file, from Unsorted)
    renaming: null,
    renameDraft: null,
    confirmDelete: null,
    adding: null, // 'top' or a section id while its Add box is open
    addDraft: '',
    thought: '',
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

  function open(id, { highlight = '' } = {}) {
    Object.assign(ui, {
      current: id,
      editing: null,
      arranging: false,
      menu: null,
      moving: null,
      renaming: null,
      adding: null,
      highlight,
    })
    render()
    document.scrollingElement.scrollTop = 0
  }

  function render() {
    if (!root.contains(body)) return // another note or template has replaced this view
    const focus = captureFocus(root)
    const ctx = session.context()
    if (ui.current !== null && !locate(session.model, ui.current)) ui.current = null
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
  function toDom(node, key) {
    if (typeof node === 'string') return mark(node, ui.highlight)
    const props = { ...node.props }
    if (node.tag === 'input') {
      props['aria-label'] = 'Checklist item'
      if (props.disabled) props['data-disabled'] = true
      if (props.dataset) {
        const n = Number(props.dataset.check)
        props.onchange = () => {
          toggleCheck(session.model, key, n, session.context().today)
          commit()
        }
      }
    }
    const children = (node.children ?? []).map((child) => toDom(child, key))
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
              h('span', { class: 'nb-row-title' }, mark(result.title, ui.query)),
              result.path.length > 0 && h('span', { class: 'meta' }, result.path.join(' › ')),
              result.snippet && h('span', { class: 'nb-preview' }, mark(result.snippet, ui.query)),
            ),
          ),
        ),
      ),
    )
  }

  function treePane() {
    const onPath = new Set(ui.current === null ? [] : pathTo(session.model, ui.current).map((section) => section.id))
    const node = (section) => {
      const isOpen = ui.expanded.has(section.id) || onPath.has(section.id)
      const hasChildren = section.children.length > 0
      return h(
        'li',
        {},
        h(
          'div',
          { class: `nb-tree-row${section.id === ui.current ? ' is-current' : ''}` },
          hasChildren
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
          h(
            'button',
            {
              type: 'button',
              class: 'nb-tree-link',
              'aria-current': section.id === ui.current ? 'page' : null,
              'data-always': '',
              onclick: () => open(section.id),
            },
            section.title,
          ),
        ),
        isOpen && hasChildren && h('ul', {}, section.children.map(node)),
      )
    }
    return h(
      'nav',
      { class: 'nb-tree', 'aria-label': 'All sections' },
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
      h('ul', {}, session.model.sections.map(node)),
    )
  }

  function pagePane(ctx) {
    if (ui.current === null) return topPage(ctx)
    const { section, depth } = locate(session.model, ui.current)
    return h(
      'section',
      { class: 'nb-page', 'aria-label': section.title },
      breadcrumb(section),
      h(
        'div',
        { class: 'nb-title-row' },
        ui.renaming === section.id ? renameInput(section, ctx) : h('h1', { class: 'nb-title' }, section.title),
        moreButton(section),
      ),
      section.edited && h('p', { class: 'meta nb-edited' }, `Edited ${shortDate(section.edited, ctx.today)}`),
      ui.menu === section.id && sectionMenu(section, depth, ctx),
      ui.moving === section.id && movePicker(section),
      textBlock(section.id, section.text, ctx),
      contentsBlock(section.id, section.children, depth < MAX_DEPTH, ctx),
    )
  }

  function topPage(ctx) {
    const { model } = session
    const unsorted = findUnsorted(model)
    const sections = model.sections.filter((section) => section !== unsorted)
    return h(
      'section',
      { class: 'nb-page', 'aria-label': rootTitle() },
      h('h1', { class: 'nb-title' }, rootTitle()),
      model.intro || ui.editing === 'intro'
        ? h('div', { class: 'nb-intro' }, textBlock('intro', model.intro, ctx))
        : h(
            'button',
            { type: 'button', class: 'text-button nb-add-intro', onclick: () => startEditing('intro') },
            'Add an introduction',
          ),
      thoughtBox(ctx),
      unsorted && unsorted.children.length > 0 && unsortedBlock(unsorted),
      contentsBlock(null, sections, true, ctx),
    )
  }

  /** Loose thoughts, each with a File button that opens the move picker. */
  function unsortedBlock(unsorted) {
    return h(
      'section',
      { class: 'nb-unsorted', 'aria-label': 'Unsorted' },
      h('h2', { class: 'nb-label' }, 'Unsorted ', h('span', { class: 'nb-count' }, String(unsorted.children.length))),
      h(
        'ul',
        { class: 'nb-slips' },
        unsorted.children.map((thought) =>
          h(
            'li',
            { class: 'nb-slip' },
            h(
              'button',
              { type: 'button', class: 'nb-slip-open', 'data-always': '', onclick: () => open(thought.id) },
              thought.title,
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'text-button',
                'aria-expanded': String(ui.moving === thought.id),
                'aria-label': `File ${thought.title}`,
                onclick: () => {
                  ui.moving = ui.moving === thought.id ? null : thought.id
                  render()
                },
              },
              'File',
            ),
            ui.moving === thought.id && movePicker(thought),
          ),
        ),
      ),
    )
  }

  /**
   * A contents page: section names with dotted leaders to when each was last edited, and
   * the sections inside them indented underneath. Arrange swaps it for handles and menus.
   */
  function contentsBlock(parentId, sections, canAdd, ctx) {
    const arranging = ui.arranging && sections.length > 0
    return h(
      'section',
      { class: 'nb-contents', 'aria-label': 'Contents' },
      (sections.length > 0 || parentId === null) &&
        h(
          'div',
          { class: 'nb-contents-head' },
          h('h2', {}, 'Contents'),
          sections.length > 0 &&
            h(
              'button',
              {
                type: 'button',
                class: 'text-button',
                'aria-pressed': String(arranging),
                onclick: () => {
                  ui.arranging = !arranging
                  ui.menu = null
                  ui.moving = null
                  render()
                },
              },
              arranging ? 'Done arranging' : 'Arrange',
            ),
        ),
      sections.length === 0 &&
        parentId === null &&
        h('p', { class: 'empty' }, 'No sections yet. Add one, or paste a whole note.'),
      arranging ? sectionList(sections, ctx) : h('ul', { class: 'toc' }, sections.map((section) => tocEntry(section, 1, ctx))),
      canAdd && addControl(parentId, ctx),
    )
  }

  function tocEntry(section, level, ctx) {
    const preview = level === 1 && plainPreview(section.text)
    const deeper = level === 2 ? countInside(section) : 0
    return h(
      'li',
      { class: `toc-item level-${level}` },
      h(
        'button',
        { type: 'button', class: 'toc-entry', 'data-always': '', onclick: () => open(section.id) },
        h('span', { class: 'toc-title' }, section.title),
        section.edited && [
          h('span', { class: 'toc-leader', 'aria-hidden': 'true' }),
          h('span', { class: 'toc-meta' }, shortDate(section.edited, ctx.today)),
        ],
      ),
      preview && h('p', { class: 'toc-preview' }, preview),
      level === 1 &&
        section.children.length > 0 &&
        h(
          'ul',
          { class: 'toc' },
          section.children.map((child) => tocEntry(child, 2, ctx)),
        ),
      deeper > 0 && h('p', { class: 'toc-more' }, `and ${deeper} more inside`),
    )
  }

  function breadcrumb(section) {
    const crumb = (label, id) =>
      h('button', { type: 'button', class: 'crumb', 'data-always': '', onclick: () => open(id) }, label)
    return h(
      'nav',
      { class: 'nb-crumbs', 'aria-label': 'Where you are' },
      crumb(rootTitle(), null),
      pathTo(session.model, section.id)
        .slice(0, -1)
        .map((ancestor) => [h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'), crumb(ancestor.title, ancestor.id)]),
    )
  }

  function startEditing(key) {
    ui.editing = key
    ui.focusTarget = `edit-${key}`
    render()
  }

  function textBlock(key, text, ctx) {
    if (ui.editing === key) return editor(key, text, ctx)
    return h(
      'div',
      { class: 'nb-text' },
      text &&
        h(
          'div',
          { class: 'md' },
          renderMarkdown(text).map((node) => toDom(node, key)),
        ),
      h('button', { type: 'button', class: 'text-button', onclick: () => startEditing(key) }, text ? 'Edit' : 'Add text'),
    )
  }

  function editor(key, text, ctx) {
    const update = (value) => {
      if (key === 'intro') session.model.intro = value
      else setSectionText(session.model, key, value, ctx.today)
      saveSoon()
    }
    const textarea = h('textarea', {
      class: 'nb-editor',
      rows: 6,
      value: text,
      'aria-label': key === 'intro' ? 'Introduction' : 'Section text',
      'data-focus': `edit-${key}`,
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
        tool('•', 'Bulleted list', (state) => prefixLines(state, '- ')),
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
              ui.editing = null
              commit()
            },
          },
          'Done',
        ),
      ),
    )
  }

  const sectionList = (sections, ctx) =>
    h(
      'ul',
      { class: 'nb-list' },
      sections.map((section) => sectionRow(section, ctx)),
    )

  /** A row in Arrange mode: drag handle, name and ⋯ menu. */
  function sectionRow(section, ctx) {
    return h(
      'li',
      { class: 'nb-row', dataset: { id: section.id } },
      dragHandle(section),
      h(
        'button',
        { type: 'button', class: 'nb-open', 'data-always': '', onclick: () => open(section.id) },
        h('span', { class: 'nb-row-title' }, section.title),
      ),
      moreButton(section),
      ui.menu === section.id && sectionMenu(section, locate(session.model, section.id).depth, ctx),
      ui.moving === section.id && movePicker(section),
    )
  }

  const moreButton = (section) =>
    h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': `More actions for ${section.title}`,
        'aria-expanded': String(ui.menu === section.id),
        onclick: () => {
          ui.menu = ui.menu === section.id ? null : section.id
          ui.moving = null
          ui.confirmDelete = null
          render()
        },
      },
      '⋯',
    )

  function sectionMenu(section, depth, ctx) {
    const confirming = ui.confirmDelete === section.id
    const inside = countInside(section)
    const button = (text, onclick, props = {}) => h('button', { type: 'button', class: 'button', onclick, ...props }, text)
    return h(
      'div',
      { class: 'button-row nb-menu' },
      button('Rename', () => {
        if (ui.current !== section.id) open(section.id)
        Object.assign(ui, { renaming: section.id, renameDraft: null, menu: null, focusTarget: `rename-${section.id}` })
        render()
      }),
      button(
        'Add section inside',
        () => {
          if (ui.current !== section.id) open(section.id)
          Object.assign(ui, { adding: section.id, addDraft: '', menu: null, focusTarget: `add-${section.id}` })
          render()
        },
        { 'data-disabled': depth >= MAX_DEPTH },
      ),
      button('Move…', () => {
        ui.moving = ui.moving === section.id ? null : section.id
        render()
      }),
      button(
        confirming ? `Tap again to delete${inside ? ` it and ${inside} inside` : ''}` : 'Delete',
        () => {
          if (!confirming) {
            ui.confirmDelete = section.id
            render()
            setTimeout(() => {
              if (ui.confirmDelete !== section.id) return
              ui.confirmDelete = null
              render()
            }, DELETE_CONFIRM_MS)
            return
          }
          const parent = locate(session.model, section.id)?.parent ?? null
          deleteSection(session.model, section.id)
          if (ui.current === section.id) ui.current = parent?.id ?? null
          ui.menu = null
          ui.confirmDelete = null
          commit()
        },
        { class: `button danger${confirming ? ' is-confirming' : ''}` },
      ),
    )
  }

  function movePicker(section) {
    const targets = moveTargets(session.model, section.id)
    const filing = locate(session.model, section.id)?.parent === findUnsorted(session.model)
    const prompt = filing ? `File "${section.title}" under:` : `Move "${section.title}" into:`
    return h(
      'div',
      { class: 'nb-move' },
      h('p', { class: 'meta' }, targets.length ? prompt : 'There is nowhere else this section fits.'),
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
                  moveSection(session.model, section.id, target.id)
                  ui.moving = null
                  ui.menu = null
                  commit()
                },
              },
              target.id === null ? 'Top level' : target.title,
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

  function renameInput(section, ctx) {
    const finish = (value) => {
      if (ui.renaming !== section.id) return
      if (value !== null) renameSection(session.model, section.id, value, ctx.today)
      ui.renaming = null
      ui.renameDraft = null
      if (value !== null) commit()
      else render()
    }
    return h('input', {
      type: 'text',
      class: 'field nb-rename',
      value: ui.renameDraft ?? section.title,
      'aria-label': `New name for ${section.title}`,
      enterkeyhint: 'done',
      'data-focus': `rename-${section.id}`,
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

  function addControl(parentId, ctx) {
    const key = parentId ?? 'top'
    if (ui.adding !== key) {
      return h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          onclick: () => {
            Object.assign(ui, { adding: key, addDraft: '', focusTarget: `add-${key}` })
            render()
          },
        },
        parentId === null ? '+ Add section' : '+ Add a section inside',
      )
    }
    const add = () => {
      if (!addSection(session.model, parentId, ui.addDraft, ctx.today)) return
      ui.adding = null
      ui.addDraft = ''
      commit()
    }
    return h(
      'div',
      { class: 'nb-add' },
      h('textarea', {
        class: 'add-input',
        rows: 3,
        placeholder: 'A name, or paste a whole note (its first line becomes the name)',
        'aria-label': 'New section',
        value: ui.addDraft,
        'data-focus': `add-${key}`,
        oninput: (event) => {
          ui.addDraft = event.target.value
          autosize(event.target)
        },
      }),
      h(
        'div',
        { class: 'button-row' },
        h('button', { type: 'button', class: 'button primary', onclick: add }, 'Add section'),
        h(
          'button',
          {
            type: 'button',
            class: 'text-button',
            onclick: () => {
              ui.adding = null
              render()
            },
          },
          'Cancel',
        ),
      ),
    )
  }

  function thoughtBox(ctx) {
    const add = () => {
      if (!addThought(session.model, ui.thought, ctx.today)) return
      ui.thought = ''
      commit()
    }
    return h(
      'div',
      { class: 'nb-thought' },
      h('textarea', {
        class: 'add-input',
        rows: 1,
        placeholder: 'Add a thought…',
        'aria-label': 'Add a thought to Unsorted',
        enterkeyhint: 'done',
        value: ui.thought,
        'data-focus': 'thought',
        oninput: (event) => {
          ui.thought = event.target.value
          autosize(event.target)
        },
        onkeydown: (event) => {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
          event.preventDefault()
          add()
        },
      }),
      h('button', { type: 'button', class: 'text-button nb-thought-add', onclick: add }, 'Add'),
    )
  }

  function dragHandle(section) {
    return h(
      'button',
      {
        type: 'button',
        class: 'drag-handle',
        'aria-label': `Move ${section.title}: drag, or use the arrow keys`,
        'data-focus': `handle-${section.id}`,
        onpointerdown: (event) => startDrag(event, section),
        onkeydown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          if (moveSectionByOne(session.model, section.id, event.key === 'ArrowUp' ? -1 : 1)) commit()
        },
      },
      '⠿',
    )
  }

  /** Drags a section among its siblings by its handle (mouse or touch). Move… changes its parent. */
  function startDrag(event, section) {
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
      reorderSection(session.model, section.id, target ? Number(target.dataset.id) : null)
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
