import { shortDate, weekdayOf } from './dates.js'
import { autosize, captureFocus, h, restoreFocus } from './dom.js'
import {
  DAY_NAMES,
  EVERY_DAY,
  WEEK_ORDER,
  addGroup,
  addTodos,
  allTags,
  bringBack,
  complete,
  deleteGroup,
  describeDays,
  doToday,
  editTodo,
  markReviewed,
  moveByOne,
  moveGroup,
  moveToEdge,
  moveToGroup,
  nextScheduled,
  park,
  placeTodo,
  removeTodo,
  renameGroup,
  reopen,
  reviewDue,
  routineFor,
  sections,
  setDue,
  setRating,
  setRepeat,
  sortTodos,
  undoToday,
} from './todos.js'

const DELETE_CONFIRM_MS = 3000

// Filter buttons besides tags. Their ids start with '!', which a tag can't.
const RATING_FILTERS = [
  { id: '!priority', label: 'High priority', matches: (item) => item.priority === 'high' && item.status !== 'done' },
  { id: '!value', label: 'High value', matches: (item) => item.value === 'high' && item.status !== 'done' },
]

function matchesFilter(item, filter) {
  if (!filter) return true
  const rating = RATING_FILTERS.find((candidate) => candidate.id === filter)
  return rating ? rating.matches(item) : item.tags.includes(filter)
}

/**
 * Renders a Todos note into `root`. `session` gives the model, the current context
 * ({ today, staleDays }), whether the note is read-only, `save()` and `setSetting()`.
 */
export function mountTodos(root, session) {
  const ui = {
    filter: null, // tag being shown, or null for all
    openActions: null, // id of the todo whose extra actions are open
    confirmDelete: null, // id waiting for a second tap on Delete
    review: null, // { ids, index } while stepping through parked todos
    showParked: false,
    showDone: false,
    showLater: false,
    showSettings: false,
    collapsed: new Set(), // names of collapsed groups
    groupMenu: null, // group whose actions are open
    confirmGroupDelete: null,
    renaming: null, // group being renamed
    renameDraft: null,
    addingTo: null, // group with its add box open
    newGroup: null, // draft name while creating a group, or null
    groupError: null,
    focusTarget: null, // data-focus key to focus after the next render
  }

  const addInput = h('textarea', {
    class: 'add-input',
    rows: 1,
    placeholder: 'Add a todo…  (#tag to group)',
    'aria-label': 'New todo. Paste a list to add one per line.',
    enterkeyhint: 'done',
    oninput: () => autosize(addInput),
    onkeydown: (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        submitAdd()
      }
    },
  })
  const addDue = h('input', { type: 'date', class: 'field add-due', 'aria-label': 'Due date (optional)' })
  const lockBadge = h('span', { class: 'lock-badge', hidden: true }, '🔒 Locked')
  const settingsButton = h(
    'button',
    {
      type: 'button',
      class: 'icon-button',
      'aria-label': 'Settings',
      'aria-expanded': 'false',
      'data-always': '',
      onclick: () => {
        ui.showSettings = !ui.showSettings
        render()
      },
    },
    '⚙︎',
  )
  const body = h('div', { class: 'todos-body' })
  let rendering = false

  root.replaceChildren(
    h(
      'div',
      { class: 'todos' },
      h('header', { class: 'view-header' }, h('h1', {}, 'Todos'), lockBadge, settingsButton),
      h(
        'form',
        {
          class: 'add',
          onsubmit: (event) => {
            event.preventDefault()
            submitAdd()
          },
        },
        addInput,
        addDue,
        h('button', { type: 'submit', class: 'button primary' }, 'Add'),
      ),
      body,
    ),
  )

  function commit() {
    session.save()
    render()
  }

  function submitAdd() {
    if (session.readOnly) return
    const added = addTodos(session.model, addInput.value, { today: session.context().today, due: addDue.value || null })
    if (added.length === 0) return
    applyFilter(added)
    addInput.value = ''
    addDue.value = ''
    autosize(addInput)
    commit()
    addInput.focus()
  }

  /** Adding while filtered files new todos under that tag or rating. */
  function applyFilter(items) {
    for (const item of items) {
      if (ui.filter === '!priority') item.priority ||= 'high'
      else if (ui.filter === '!value') item.value ||= 'high'
      else if (ui.filter && item.tags.length === 0) item.tags.push(ui.filter)
    }
  }

  function filterLabel() {
    const rating = RATING_FILTERS.find((candidate) => candidate.id === ui.filter)
    return rating ? rating.label.toLowerCase() : `#${ui.filter}`
  }

  const label = (item) => [item.text, ...item.tags.map((tag) => `#${tag}`)].join(' ')
  const inGroup = (item) => (item.group ? ` · in ${item.group}` : '')

  const ratingBadges = (item) =>
    ['priority', 'value']
      .filter((key) => item[key])
      .map((key) => h('span', { class: `badge badge-${key}-${item[key]}` }, `${item[key] === 'high' ? 'High' : 'Low'} ${key}`))

  function render() {
    if (!root.contains(body)) return // another note or template has replaced this view
    const focus = captureFocus(root)
    const ctx = session.context()
    const { model } = session
    const tags = allTags(model)
    const ratings = RATING_FILTERS.filter((rating) => model.items.some(rating.matches))
    if (ui.filter && ![...ratings.map((rating) => rating.id), ...tags].includes(ui.filter)) ui.filter = null
    const shown = (item) => matchesFilter(item, ui.filter)
    const lists = sections(model, ctx.today)
    const { parked, done } = lists
    const routine = routineFor(model, ctx.today)
    const routineToday = routine.today.filter(shown)
    const routineLater = routine.later.filter(shown)
    const hasRoutine = routineToday.length + routineLater.length > 0
    const reviewItem = currentReviewItem()

    const parts = [
      ui.showSettings && settingsPanel(ctx),
      reviewItem
        ? reviewCard(reviewItem, ctx)
        : !session.readOnly && reviewDue(model, ctx.today) && reviewBanner(parked.length),
      tags.length + ratings.length > 0 && chips(tags, ratings),
      hasRoutine && routineSection(routineToday, routineLater, ctx),
      todoArea(lists, ctx, shown),
      parked.some(shown) &&
        group(
          'showParked',
          `Parked (${parked.filter(shown).length})`,
          `Untouched for ${ctx.staleDays}+ days. Bring back anything you still want.`,
          parked.filter(shown).map((item) => parkedRow(item, ctx)),
        ),
      done.some(shown) &&
        group(
          'showDone',
          `Done (${done.filter(shown).length})`,
          null,
          done.filter(shown).map((item) => doneRow(item, ctx)),
        ),
      model.other &&
        h(
          'details',
          { class: 'group' },
          h('summary', {}, 'Other text in this note'),
          h('p', { class: 'group-hint' }, 'Kept as it is. Edit it in the plain text editor.'),
          h('pre', { class: 'other-text' }, model.other),
        ),
    ]
    rendering = true
    body.replaceChildren(...parts.filter(Boolean))
    rendering = false
    body.querySelectorAll('.todo-text').forEach(autosize)

    settingsButton.setAttribute('aria-expanded', String(ui.showSettings))
    lockBadge.hidden = !session.readOnly
    // data-disabled marks controls that are off for their own reasons, like "Move up" on the first group.
    for (const control of root.querySelectorAll('input, textarea, button, select')) {
      if (!('always' in control.dataset)) control.disabled = session.readOnly || 'disabled' in control.dataset
    }
    restoreFocus(root, focus)
    if (ui.focusTarget) {
      root.querySelector(`[data-focus="${CSS.escape(ui.focusTarget)}"]`)?.focus()
      ui.focusTarget = null
    }
  }

  function chips(tags, ratings) {
    const chip = (filter, text) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(ui.filter === filter),
          'data-always': '',
          onclick: () => {
            ui.filter = filter
            render()
          },
        },
        text,
      )
    return h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Filter' },
      chip(null, 'All'),
      ratings.map((rating) => chip(rating.id, rating.label)),
      tags.map((tag) => chip(tag, `#${tag}`)),
    )
  }

  function ratingControls(item, ctx) {
    const field = (key, title) =>
      h(
        'div',
        { class: 'option-field' },
        h('span', { class: 'field-label' }, title),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': title },
          [
            ['low', 'Low', `Low ${key}`],
            [null, '–', `${title} not rated`],
            ['high', 'High', `High ${key}`],
          ].map(([level, text, ariaLabel]) =>
            h(
              'button',
              {
                type: 'button',
                class: 'segment',
                'aria-pressed': String(item[key] === level),
                'aria-label': ariaLabel,
                onclick: () => {
                  setRating(item, key, level, ctx.today)
                  commit()
                },
              },
              text,
            ),
          ),
        ),
      )
    return h('div', { class: 'option-row' }, field('priority', 'Priority'), field('value', 'Value'))
  }

  const sortButton = (text, ariaLabel, sort) =>
    h(
      'button',
      {
        type: 'button',
        class: 'text-button',
        'aria-label': ariaLabel,
        onclick: () => {
          sort()
          commit()
        },
      },
      text,
    )

  // Lists are drop zones for dragging: `data-drop-group` names the group ('' for ungrouped).
  const todoList = (items, ctx) =>
    h(
      'ul',
      { class: 'todo-list', 'data-list': '' },
      items.map((item) => activeRow(item, ctx)),
    )

  function todoArea(lists, ctx, shown) {
    const filtering = Boolean(ui.filter)
    const groups = lists.groups
      .map((group) => ({ ...group, items: group.items.filter(shown) }))
      .filter((group) => !filtering || group.items.length > 0)
    const ungrouped = lists.ungrouped.filter(shown)
    const nothing = ungrouped.length === 0 && groups.every((group) => group.items.length === 0)
    return h(
      'div',
      { class: 'todo-area' },
      h(
        'section',
        { class: 'todo-group', 'aria-label': 'To do', 'data-drop-group': '' },
        h(
          'div',
          { class: 'section-head' },
          h('h2', { class: 'section-title' }, 'To do'),
          lists.active.length > 1 &&
            sortButton('Sort all', 'Sort every list by due date and priority', () => sortTodos(session.model, ctx.today)),
        ),
        todoList(ungrouped, ctx),
        nothing &&
          (filtering || groups.length === 0) &&
          h('p', { class: 'empty' }, filtering ? `Nothing to do in ${filterLabel()}.` : 'Nothing to do. Enjoy it.'),
      ),
      groups.map((group) => groupSection(group, ctx)),
      !filtering && newGroupControl(),
    )
  }

  function groupSection({ name, items }, ctx) {
    const collapsed = ui.collapsed.has(name)
    const menuOpen = ui.groupMenu === name
    return h(
      'section',
      { class: 'todo-group group-section', 'aria-label': name, 'data-drop-group': name },
      h(
        'div',
        { class: 'section-head group-head' },
        ui.renaming === name
          ? renameInput(name)
          : h(
              'button',
              {
                type: 'button',
                class: 'group-toggle',
                'aria-expanded': String(!collapsed),
                'data-always': '',
                onclick: () => {
                  if (collapsed) ui.collapsed.delete(name)
                  else ui.collapsed.add(name)
                  render()
                },
              },
              h('span', { class: 'caret', 'aria-hidden': 'true' }, collapsed ? '▸' : '▾'),
              h('span', { class: 'group-name' }, name),
              h('span', { class: 'group-count' }, String(items.length)),
            ),
        h(
          'div',
          { class: 'group-tools' },
          items.length > 1 &&
            !collapsed &&
            sortButton('Sort', `Sort ${name} by due date and priority`, () => sortTodos(session.model, ctx.today, name)),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button',
              'aria-label': `Add a todo to ${name}`,
              onclick: () => {
                ui.addingTo = name
                ui.collapsed.delete(name)
                ui.focusTarget = `add-${name}`
                render()
              },
            },
            '+',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'icon-button',
              'aria-label': `More actions for group ${name}`,
              'aria-expanded': String(menuOpen),
              onclick: () => {
                ui.groupMenu = menuOpen ? null : name
                ui.confirmGroupDelete = null
                render()
              },
            },
            '⋯',
          ),
        ),
      ),
      ui.renaming === name && ui.groupError && h('p', { class: 'meta error' }, ui.groupError),
      menuOpen && groupActions(name),
      ui.addingTo === name && groupAddRow(name, ctx),
      !collapsed && todoList(items, ctx),
      !collapsed && items.length === 0 && ui.addingTo !== name && h('p', { class: 'empty' }, 'Nothing here yet.'),
    )
  }

  function groupActions(name) {
    const { groups } = session.model
    const index = groups.indexOf(name)
    const confirming = ui.confirmGroupDelete === name
    const button = (text, onclick, props = {}) => h('button', { type: 'button', class: 'button', onclick, ...props }, text)
    return h(
      'div',
      { class: 'button-row group-actions' },
      button('Rename', () => {
        ui.renaming = name
        ui.groupError = null
        ui.focusTarget = `rename-${name}`
        render()
      }),
      button('Move up', () => moveGroup(session.model, name, -1) && commit(), { 'data-disabled': index === 0 }),
      button('Move down', () => moveGroup(session.model, name, 1) && commit(), {
        'data-disabled': index === groups.length - 1,
      }),
      button(
        confirming ? 'Tap again: its todos become ungrouped' : 'Delete group',
        () => {
          if (!confirming) {
            ui.confirmGroupDelete = name
            render()
            setTimeout(() => {
              if (ui.confirmGroupDelete !== name) return
              ui.confirmGroupDelete = null
              render()
            }, DELETE_CONFIRM_MS)
            return
          }
          deleteGroup(session.model, name)
          ui.groupMenu = null
          ui.confirmGroupDelete = null
          ui.collapsed.delete(name)
          commit()
        },
        { class: `button danger${confirming ? ' is-confirming' : ''}` },
      ),
    )
  }

  function renameInput(name) {
    // Enter on a bad name explains why; leaving the box with one just cancels.
    const finish = (value, explainError) => {
      if (ui.renaming !== name) return
      if (value !== null && value.trim() !== name) {
        const renamed = renameGroup(session.model, name, value)
        if (renamed) {
          if (ui.collapsed.delete(name)) ui.collapsed.add(renamed)
          session.save()
        } else if (explainError) {
          ui.groupError = 'That name is taken, empty, or reserved (Parked, Done).'
          ui.focusTarget = `rename-${name}`
          render()
          return
        }
      }
      ui.renaming = null
      ui.renameDraft = null
      ui.groupMenu = null
      ui.groupError = null
      render()
    }
    return h('input', {
      type: 'text',
      class: 'field group-rename',
      value: ui.renameDraft ?? name,
      'aria-label': `New name for ${name}`,
      enterkeyhint: 'done',
      'data-focus': `rename-${name}`,
      oninput: (event) => {
        ui.renameDraft = event.target.value
      },
      onkeydown: (event) => {
        if (event.key === 'Escape') finish(null, false)
        if (event.key !== 'Enter') return
        event.preventDefault()
        finish(event.target.value, true)
      },
      // Chrome blurs a focused element when a re-render removes it; that isn't the user leaving.
      onblur: (event) => rendering || finish(event.target.value, false),
    })
  }

  function groupAddRow(name, ctx) {
    return h(
      'div',
      { class: 'group-add-row' },
      h('textarea', {
        class: 'add-input',
        rows: 1,
        placeholder: `Add to ${name}…`,
        'aria-label': `New todo in ${name}`,
        enterkeyhint: 'done',
        'data-focus': `add-${name}`,
        oninput: (event) => autosize(event.target),
        onkeydown: (event) => {
          if (event.key === 'Escape') {
            ui.addingTo = null
            render()
            return
          }
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
          event.preventDefault()
          const added = addTodos(session.model, event.target.value, { today: ctx.today, group: name })
          if (added.length === 0) {
            ui.addingTo = null
            render()
            return
          }
          applyFilter(added)
          commit()
        },
      }),
      h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          onclick: () => {
            ui.addingTo = null
            render()
          },
        },
        'Done',
      ),
    )
  }

  function newGroupControl() {
    if (ui.newGroup === null) {
      return h(
        'button',
        {
          type: 'button',
          class: 'text-button new-group',
          onclick: () => {
            ui.newGroup = ''
            ui.groupError = null
            ui.focusTarget = 'new-group'
            render()
          },
        },
        '+ New group',
      )
    }
    const create = () => {
      const name = addGroup(session.model, ui.newGroup)
      if (!name) {
        ui.groupError = 'That name is taken, empty, or reserved (Parked, Done).'
        ui.focusTarget = 'new-group'
        render()
        return
      }
      ui.newGroup = null
      ui.groupError = null
      ui.addingTo = name
      ui.focusTarget = `add-${name}`
      commit()
    }
    return h(
      'div',
      { class: 'new-group-row' },
      h('input', {
        type: 'text',
        class: 'field',
        value: ui.newGroup,
        placeholder: 'Group name',
        'aria-label': 'New group name',
        enterkeyhint: 'done',
        'data-focus': 'new-group',
        oninput: (event) => {
          ui.newGroup = event.target.value
        },
        onkeydown: (event) => {
          if (event.key === 'Escape') {
            ui.newGroup = null
            render()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            create()
          }
        },
      }),
      h('button', { type: 'button', class: 'button primary', onclick: create }, 'Create'),
      h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          onclick: () => {
            ui.newGroup = null
            render()
          },
        },
        'Cancel',
      ),
      ui.groupError && h('p', { class: 'meta error' }, ui.groupError),
    )
  }

  function moveControls(item, ctx) {
    const { groups } = session.model
    const toEdge = (edge) => () => {
      moveToEdge(session.model, item, edge)
      commit()
    }
    return h(
      'div',
      { class: 'option-row' },
      groups.length > 0 &&
        h(
          'label',
          { class: 'option-field' },
          h('span', { class: 'field-label' }, 'Group'),
          h(
            'select',
            {
              class: 'field',
              onchange: (event) => {
                moveToGroup(session.model, item, event.target.value || null, ctx.today)
                commit()
              },
            },
            h('option', { value: '', selected: !item.group }, 'No group'),
            groups.map((name) => h('option', { value: name, selected: item.group === name }, name)),
          ),
        ),
      h(
        'div',
        { class: 'option-field' },
        h('span', { class: 'field-label' }, 'Move'),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': 'Move' },
          h('button', { type: 'button', class: 'segment', onclick: toEdge('top') }, 'To top'),
          h('button', { type: 'button', class: 'segment', onclick: toEdge('bottom') }, 'To bottom'),
        ),
      ),
    )
  }

  function dragHandle(item) {
    return h(
      'button',
      {
        type: 'button',
        class: 'drag-handle',
        'aria-label': `Move ${item.text}: drag, or use the arrow keys`,
        'data-focus': `handle-${item.id}`,
        onpointerdown: (event) => startDrag(event, item),
        onkeydown: (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          if (moveByOne(session.model, item, event.key === 'ArrowUp' ? -1 : 1)) commit()
        },
      },
      '⠿',
    )
  }

  /** Drags a todo by its handle; works with mouse and touch through pointer events. */
  function startDrag(event, item) {
    if (session.readOnly || event.button > 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const row = handle.closest('.todo')
    handle.setPointerCapture(event.pointerId)
    row.classList.add('is-dragging')
    document.body.classList.add('is-dragging-todo')
    const indicator = h('li', { class: 'drop-indicator', 'aria-hidden': 'true' })
    let target = null
    let pointer = { x: event.clientX, y: event.clientY }

    const locate = ({ x, y }) => {
      const zone = document.elementFromPoint(x, y)?.closest('[data-drop-group]')
      if (!zone || !root.contains(zone)) return null
      const list = zone.querySelector(':scope > .todo-list[data-list]')
      const rows = list ? [...list.children].filter((child) => child.matches('.todo[data-id]') && child !== row) : []
      const next = rows.find((candidate) => {
        const box = candidate.getBoundingClientRect()
        return y < box.top + box.height / 2
      })
      return { zone, list, next: next ?? null, group: zone.dataset.dropGroup || null }
    }
    const update = () => {
      target = locate(pointer)
      indicator.remove()
      root.querySelector('.is-drop-target')?.classList.remove('is-drop-target')
      if (!target) return
      if (target.list) target.list.insertBefore(indicator, target.next)
      else target.zone.classList.add('is-drop-target') // a collapsed group
    }
    // Scrolls when the pointer is near the top or bottom edge.
    let scrollFrame = requestAnimationFrame(function scroll() {
      const edge = 48
      const step = pointer.y < edge ? -12 : pointer.y > window.innerHeight - edge ? 12 : 0
      if (step) {
        window.scrollBy(0, step)
        update()
      }
      scrollFrame = requestAnimationFrame(scroll)
    })

    const onMove = (moveEvent) => {
      pointer = { x: moveEvent.clientX, y: moveEvent.clientY }
      update()
    }
    const finish = (drop) => {
      cancelAnimationFrame(scrollFrame)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onCancel)
      document.body.classList.remove('is-dragging-todo')
      indicator.remove()
      if (!drop || !target) return render()
      const before = target.next
        ? session.model.items.find((candidate) => candidate.id === Number(target.next.dataset.id))
        : null
      placeTodo(session.model, item, { group: target.group, before, today: session.context().today })
      commit()
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onCancel)
  }

  function moreButton(item) {
    const isOpen = ui.openActions === item.id
    return h(
      'button',
      {
        type: 'button',
        class: 'icon-button',
        'aria-label': `More actions for ${item.text}`,
        'aria-expanded': String(isOpen),
        onclick: () => {
          ui.openActions = isOpen ? null : item.id
          ui.confirmDelete = null
          render()
        },
      },
      '⋯',
    )
  }

  function deleteButton(item, afterDelete = () => {}) {
    const confirming = ui.confirmDelete === item.id
    return h(
      'button',
      {
        type: 'button',
        class: `button danger${confirming ? ' is-confirming' : ''}`,
        onclick: () => {
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
          removeTodo(session.model, item)
          ui.confirmDelete = null
          ui.openActions = null
          afterDelete()
          commit()
        },
      },
      confirming ? 'Tap again to delete' : 'Delete',
    )
  }

  // A textarea so long todos wrap on a phone; Enter finishes the edit instead of a new line.
  function textField(item, ctx) {
    return h('textarea', {
      class: 'todo-text',
      rows: 1,
      value: label(item),
      'aria-label': 'Todo',
      enterkeyhint: 'done',
      'data-focus': `text-${item.id}`,
      // Saves as you type but doesn't re-sort, so the row stays put while you edit.
      oninput: (event) => {
        autosize(event.target)
        if (editTodo(item, event.target.value, ctx.today)) session.save()
      },
      onkeydown: (event) => {
        if (event.key !== 'Enter' || event.isComposing) return
        event.preventDefault()
        event.target.blur()
      },
    })
  }

  function routineSection(todayItems, laterItems, ctx) {
    const doneCount = todayItems.filter((item) => item.done === ctx.today).length
    return h(
      'section',
      { class: 'routine', 'aria-label': 'Routine' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { class: 'section-title' }, 'Routine'),
        todayItems.length > 0 && h('span', { class: 'meta' }, `${doneCount} of ${todayItems.length} done today`),
      ),
      todayItems.length > 0
        ? h(
            'ul',
            { class: 'todo-list' },
            todayItems.map((item) => routineRow(item, ctx)),
          )
        : h('p', { class: 'empty' }, 'Nothing scheduled today.'),
      laterItems.length > 0 &&
        group(
          'showLater',
          `Not today (${laterItems.length})`,
          null,
          laterItems.map((item) => laterRow(item, ctx)),
          laterItems.some((item) => item.id === ui.openActions),
        ),
    )
  }

  function routineRow(item, ctx) {
    const doneToday = item.done === ctx.today
    return h(
      'li',
      { class: `todo is-routine${doneToday ? ' is-done-today' : ''}` },
      h('input', {
        type: 'checkbox',
        class: 'todo-check',
        checked: doneToday,
        'aria-label': `Done today: ${item.text}`,
        onchange: (event) => {
          if (event.target.checked) doToday(item, ctx.today)
          else undoToday(item, ctx.today)
          commit()
        },
      }),
      h(
        'div',
        { class: 'todo-main' },
        textField(item, ctx),
        h(
          'span',
          { class: 'meta' },
          describeDays(item.repeat),
          item.streak > 0 && h('span', { class: 'streak' }, ` · 🔥 ${item.streak} in a row`),
        ),
      ),
      moreButton(item),
      ui.openActions === item.id && h('div', { class: 'todo-actions' }, repeatControls(item, ctx), deleteButton(item)),
    )
  }

  function laterRow(item, ctx) {
    const next = nextScheduled(ctx.today, item.repeat)
    return h(
      'li',
      { class: 'todo is-later' },
      h(
        'div',
        { class: 'todo-main' },
        h('span', { class: 'todo-label' }, label(item)),
        h('span', { class: 'meta' }, `${describeDays(item.repeat)} · next on ${DAY_NAMES[weekdayOf(next)]}`),
      ),
      moreButton(item),
      ui.openActions === item.id && h('div', { class: 'todo-actions' }, repeatControls(item, ctx), deleteButton(item)),
    )
  }

  function repeatControls(item, ctx) {
    const days = item.repeat ?? []
    const isCustom = Boolean(item.repeat) && days.length < 7
    const choose = (next) => {
      setRepeat(item, next, ctx.today)
      commit()
    }
    const option = (text, pressed, onclick) =>
      h('button', { type: 'button', class: 'segment', 'aria-pressed': String(pressed), onclick }, text)
    return h(
      'div',
      { class: 'repeat-field' },
      h('span', { class: 'field-label' }, 'Repeat'),
      h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Repeat' },
        option('Never', !item.repeat, () => choose(null)),
        option('Every day', days.length === 7, () => choose(EVERY_DAY)),
        option('Choose days', isCustom, () => isCustom || choose([weekdayOf(ctx.today)])),
      ),
      isCustom &&
        h(
          'div',
          { class: 'day-picker', role: 'group', 'aria-label': 'Repeat on' },
          WEEK_ORDER.map((day) =>
            h(
              'button',
              {
                type: 'button',
                class: 'day',
                'aria-pressed': String(days.includes(day)),
                'aria-label': DAY_NAMES[day],
                title: DAY_NAMES[day],
                onclick: () => choose(days.includes(day) ? days.filter((other) => other !== day) : [...days, day]),
              },
              DAY_NAMES[day][0],
            ),
          ),
        ),
    )
  }

  function activeRow(item, ctx) {
    const overdue = item.due && item.due < ctx.today
    return h(
      'li',
      { class: `todo has-handle${overdue ? ' is-overdue' : ''}`, dataset: { id: item.id } },
      dragHandle(item),
      h('input', {
        type: 'checkbox',
        class: 'todo-check',
        'aria-label': `Done: ${item.text}`,
        onchange: () => {
          complete(item, ctx.today)
          commit()
        },
      }),
      h(
        'div',
        { class: 'todo-main' },
        textField(item, ctx),
        (item.due || item.priority || item.value) &&
          h(
            'div',
            { class: 'todo-meta' },
            item.due &&
              h(
                'span',
                { class: 'due' },
                overdue ? `Overdue · ${shortDate(item.due, ctx.today)}` : `Due ${shortDate(item.due, ctx.today)}`,
              ),
            ratingBadges(item),
          ),
      ),
      moreButton(item),
      ui.openActions === item.id &&
        h(
          'div',
          { class: 'todo-actions' },
          repeatControls(item, ctx),
          ratingControls(item, ctx),
          moveControls(item, ctx),
          h(
            'label',
            { class: 'inline-field' },
            'Due',
            h('input', {
              type: 'date',
              class: 'field',
              value: item.due ?? '',
              onchange: (event) => {
                setDue(item, event.target.value, ctx.today)
                commit()
              },
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              onclick: () => {
                park(item)
                ui.openActions = null
                commit()
              },
            },
            'Park',
          ),
          deleteButton(item),
        ),
    )
  }

  function parkedRow(item, ctx) {
    return h(
      'li',
      { class: 'todo is-parked' },
      h(
        'div',
        { class: 'todo-main' },
        h('span', { class: 'todo-label' }, label(item)),
        h(
          'div',
          { class: 'todo-meta' },
          h('span', { class: 'meta' }, `Untouched since ${shortDate(item.touched, ctx.today)}${inGroup(item)}`),
          ratingBadges(item),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            bringBack(item, ctx.today)
            moveToEdge(session.model, item, 'top')
            commit()
          },
        },
        'Bring back',
      ),
      moreButton(item),
      ui.openActions === item.id &&
        h(
          'div',
          { class: 'todo-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'button',
              onclick: () => {
                complete(item, ctx.today)
                ui.openActions = null
                commit()
              },
            },
            'Mark done',
          ),
          deleteButton(item),
        ),
    )
  }

  function doneRow(item, ctx) {
    return h(
      'li',
      { class: 'todo is-done' },
      h('input', {
        type: 'checkbox',
        class: 'todo-check',
        checked: true,
        'aria-label': `Not done: ${item.text}`,
        onchange: () => {
          reopen(item, ctx.today)
          moveToEdge(session.model, item, 'top')
          commit()
        },
      }),
      h(
        'div',
        { class: 'todo-main' },
        h('span', { class: 'todo-label' }, label(item)),
        h('span', { class: 'meta' }, `Done ${shortDate(item.done, ctx.today)}${inGroup(item)}`),
      ),
      moreButton(item),
      ui.openActions === item.id && h('div', { class: 'todo-actions' }, deleteButton(item)),
    )
  }

  function group(flag, title, hint, rows, forceOpen = false) {
    return h(
      'details',
      {
        class: 'group',
        open: ui[flag] || forceOpen,
        ontoggle: (event) => {
          ui[flag] = event.target.open
        },
      },
      h('summary', {}, title),
      hint && h('p', { class: 'group-hint' }, hint),
      h('ul', { class: 'todo-list' }, rows),
    )
  }

  function reviewBanner(count) {
    return h(
      'div',
      { class: 'banner' },
      h(
        'p',
        {},
        `${count} parked ${count === 1 ? 'todo is' : 'todos are'} waiting. Still want ${count === 1 ? 'it' : 'them'}?`,
      ),
      h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'button primary',
            onclick: () => {
              const { parked } = sections(session.model, session.context().today)
              ui.review = { ids: parked.map((item) => item.id), index: 0 }
              render()
            },
          },
          'Review',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'button',
            onclick: () => {
              markReviewed(session.model, session.context().today)
              commit()
            },
          },
          'Not now',
        ),
      ),
    )
  }

  /** The parked todo being reviewed, skipping any that changed meanwhile. */
  function currentReviewItem() {
    while (ui.review && ui.review.index < ui.review.ids.length) {
      const id = ui.review.ids[ui.review.index]
      const item = session.model.items.find((candidate) => candidate.id === id)
      if (item?.status === 'parked') return item
      ui.review.index += 1
    }
    ui.review = null
    return null
  }

  function decide(action) {
    action()
    ui.review.index += 1
    if (ui.review.index >= ui.review.ids.length) {
      ui.review = null
      markReviewed(session.model, session.context().today)
    }
    commit()
  }

  function reviewCard(item, ctx) {
    const { index, ids } = ui.review
    return h(
      'section',
      { class: 'review', 'aria-label': 'Review parked todos' },
      h('p', { class: 'meta' }, `Still want this? ${index + 1} of ${ids.length}`),
      h('p', { class: 'review-text' }, label(item)),
      h(
        'div',
        { class: 'todo-meta' },
        h('span', { class: 'meta' }, `Untouched since ${shortDate(item.touched, ctx.today)}${inGroup(item)}`),
        ratingBadges(item),
      ),
      h(
        'div',
        { class: 'button-row' },
        h(
          'button',
          {
            type: 'button',
            class: 'button primary',
            onclick: () =>
              decide(() => {
                bringBack(item, ctx.today)
                moveToEdge(session.model, item, 'top')
              }),
          },
          'Bring back',
        ),
        h('button', { type: 'button', class: 'button', onclick: () => decide(() => {}) }, 'Keep parked'),
        h('button', { type: 'button', class: 'button', onclick: () => decide(() => complete(item, ctx.today)) }, 'Done'),
        deleteButton(item, () => {
          ui.review.index += 1
          if (ui.review.index >= ui.review.ids.length) {
            ui.review = null
            markReviewed(session.model, ctx.today)
          }
        }),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'text-button',
          onclick: () => {
            ui.review = null
            render()
          },
        },
        'Stop reviewing',
      ),
    )
  }

  function settingsPanel(ctx) {
    return h(
      'div',
      { class: 'settings' },
      h(
        'label',
        { class: 'inline-field' },
        'Park todos untouched for',
        h('input', {
          type: 'number',
          class: 'field number-field',
          min: 1,
          max: 365,
          value: ctx.staleDays,
          'data-always': '',
          onchange: (event) => {
            const days = Math.round(Number(event.target.value))
            if (days >= 1) session.setSetting('staleDays', days)
          },
        }),
        'days',
      ),
      h('p', { class: 'meta' }, 'Applies to all your Todos notes. Todos with a due date are never parked automatically.'),
    )
  }

  let resizeFrame = 0
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      if (root.contains(body)) body.querySelectorAll('.todo-text').forEach(autosize)
    })
  })

  render()
  return { update: render }
}
