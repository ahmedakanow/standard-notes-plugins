import { shortDate } from './dates.js'
import { autosize, captureFocus, h, restoreFocus } from './dom.js'
import {
  addTodos,
  allTags,
  bringBack,
  complete,
  editTodo,
  markReviewed,
  park,
  removeTodo,
  reopen,
  reviewDue,
  sections,
  setDue,
} from './todos.js'

const DELETE_CONFIRM_MS = 3000

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
    showSettings: false,
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
    // Adding while filtered files the new todo under that tag.
    if (ui.filter) for (const item of added) if (item.tags.length === 0) item.tags.push(ui.filter)
    addInput.value = ''
    addDue.value = ''
    autosize(addInput)
    commit()
    addInput.focus()
  }

  const label = (item) => [item.text, ...item.tags.map((tag) => `#${tag}`)].join(' ')

  function render() {
    if (!root.contains(body)) return // another note or template has replaced this view
    const focus = captureFocus(root)
    const ctx = session.context()
    const { model } = session
    const tags = allTags(model)
    if (ui.filter && !tags.includes(ui.filter)) ui.filter = null
    const shown = (item) => !ui.filter || item.tags.includes(ui.filter)
    const { active, parked, done } = sections(model, ctx.today)
    const reviewItem = currentReviewItem()

    const parts = [
      ui.showSettings && settingsPanel(ctx),
      reviewItem
        ? reviewCard(reviewItem, ctx)
        : !session.readOnly && reviewDue(model, ctx.today) && reviewBanner(parked.length),
      tags.length > 0 && chips(tags),
      activeList(active.filter(shown), ctx),
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
    body.replaceChildren(...parts.filter(Boolean))
    body.querySelectorAll('.todo-text').forEach(autosize)

    settingsButton.setAttribute('aria-expanded', String(ui.showSettings))
    lockBadge.hidden = !session.readOnly
    for (const control of root.querySelectorAll('input, textarea, button, select')) {
      if (!('always' in control.dataset)) control.disabled = session.readOnly
    }
    restoreFocus(root, focus)
  }

  function chips(tags) {
    const chip = (tag) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(ui.filter === tag),
          'data-always': '',
          onclick: () => {
            ui.filter = tag
            render()
          },
        },
        tag ? `#${tag}` : 'All',
      )
    return h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by tag' }, chip(null), tags.map(chip))
  }

  function activeList(items, ctx) {
    if (items.length === 0) {
      return h('p', { class: 'empty' }, ui.filter ? `Nothing to do in #${ui.filter}.` : 'Nothing to do. Enjoy it.')
    }
    return h(
      'ul',
      { class: 'todo-list' },
      items.map((item) => activeRow(item, ctx)),
    )
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

  function activeRow(item, ctx) {
    const overdue = item.due && item.due < ctx.today
    return h(
      'li',
      { class: `todo${overdue ? ' is-overdue' : ''}` },
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
        // A textarea so long todos wrap on a phone; Enter finishes the edit instead of a new line.
        h('textarea', {
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
        }),
        item.due &&
          h(
            'span',
            { class: 'due' },
            overdue ? `Overdue · ${shortDate(item.due, ctx.today)}` : `Due ${shortDate(item.due, ctx.today)}`,
          ),
      ),
      moreButton(item),
      ui.openActions === item.id &&
        h(
          'div',
          { class: 'todo-actions' },
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
        h('span', { class: 'meta' }, `Untouched since ${shortDate(item.touched, ctx.today)}`),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          onclick: () => {
            bringBack(item, ctx.today)
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
          commit()
        },
      }),
      h(
        'div',
        { class: 'todo-main' },
        h('span', { class: 'todo-label' }, label(item)),
        h('span', { class: 'meta' }, `Done ${shortDate(item.done, ctx.today)}`),
      ),
      moreButton(item),
      ui.openActions === item.id && h('div', { class: 'todo-actions' }, deleteButton(item)),
    )
  }

  function group(flag, title, hint, rows) {
    return h(
      'details',
      {
        class: 'group',
        open: ui[flag],
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
      h('p', { class: 'meta' }, `Untouched since ${shortDate(item.touched, ctx.today)}`),
      h(
        'div',
        { class: 'button-row' },
        h('button', { type: 'button', class: 'button primary', onclick: () => decide(() => bringBack(item, ctx.today)) }, 'Bring back'),
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
