import { createHost } from '../../shared/host.js'
import { addDays, todayIso } from './dates.js'
import { h } from './dom.js'
import { joinNote, splitNote } from './note.js'
import { TEMPLATES } from './templates.js'
import { DEFAULT_STALE_DAYS } from './todos.js'

const els = {
  loading: document.getElementById('loading'),
  previewBanner: document.getElementById('preview-banner'),
  page: document.getElementById('page'),
}

const host = createHost({ name: 'organizer', demoText })

const state = {
  note: null, // latest copy of the note from the host
  lastText: '', // note text as last loaded or saved, to tell outside edits from our own
  dirty: false, // edits not yet confirmed saved
  locked: false,
  template: null, // the TEMPLATES entry in use, or null while choosing one
  model: null,
  view: null, // what the template mounted
  picker: null, // { hasText } while the template picker is showing
}

function context() {
  const staleDays = host.getSetting('staleDays')
  return {
    today: todayIso(),
    staleDays: Number.isInteger(staleDays) && staleDays > 0 ? staleDays : DEFAULT_STALE_DAYS,
    groupsCollapsed: host.getSetting('groupsStart') !== 'expanded',
  }
}

// What templates see of the app.
const session = {
  get model() {
    return state.model
  },
  get readOnly() {
    return state.locked
  },
  get title() {
    return state.note?.content?.title ?? ''
  },
  context,
  save,
  setSetting(key, value) {
    host.setSetting(key, value)
    if (state.template.refresh(state.model, context())) save()
    state.view.update()
  },
}

function handleNote(note) {
  // A view may hold back saves while you type (Notebook does). Save that first, so it goes
  // to the right note and counts as an unsaved edit below.
  state.view?.flush?.()
  const isNewNote = state.note?.uuid !== note.uuid
  state.note = note
  state.locked = Boolean(note.content?.appData?.['org.standardnotes.sn']?.locked)

  const text = note.content?.text ?? ''
  // While we have unsaved edits our save wins, so don't overwrite what's being typed.
  const isOutsideEdit = !note.isMetadataUpdate && text !== state.lastText && !state.dirty
  if (!isNewNote && !isOutsideEdit) {
    if (state.view) state.view.update()
    else if (state.picker) showPicker(state.picker.hasText)
    return
  }
  state.lastText = text
  state.dirty = false
  if (isNewNote) state.view = null
  load(text)
}

function load(text) {
  els.loading.hidden = true
  els.page.hidden = false
  const { template: id, meta, body } = splitNote(text)
  if (!id) return showPicker(text.trim() !== '')

  const template = TEMPLATES.find((candidate) => candidate.id === id)
  if (!template || template.available === false) return showUnsupported(id)

  const model = template.parse(body, meta)
  const changed = template.refresh(model, context())
  const reuseView = state.template === template && state.view
  state.template = template
  state.model = model
  state.picker = null
  if (reuseView) state.view.update()
  else state.view = template.mount(els.page, session)
  // Dating hand-typed todos and parking stale ones are saved straight away.
  if (changed) save()
}

function save() {
  if (state.locked || !state.template) return
  const { note, model, template } = state
  const textFor = (ctx) => {
    const { body, meta } = template.serialize(model, ctx)
    return joinNote({ template: template.id, meta, body })
  }
  state.dirty = true
  host.save(
    note,
    () => {
      const ctx = context()
      const text = textFor(ctx)
      note.content.text = text
      note.content.preview_plain = template.preview(model, ctx)
      note.content.preview_html = null
      state.lastText = text
    },
    () => {
      const isCurrent = state.note.uuid === note.uuid && state.model === model && textFor(context()) === state.lastText
      if (isCurrent) state.dirty = false
    },
  )
}

function choose(id) {
  if (state.locked) return
  load(joinNote({ template: id, body: state.note.content?.text ?? '' }))
  save()
}

function showPicker(hasText) {
  state.template = null
  state.model = null
  state.view = null
  state.picker = { hasText }
  els.page.replaceChildren(
    h(
      'section',
      { class: 'picker' },
      h('h1', {}, "What's this note for?"),
      h(
        'p',
        { class: 'meta' },
        hasText ? 'Your existing text will be kept.' : 'You can only choose once per note, so pick what fits.',
      ),
      h(
        'div',
        { class: 'picker-options' },
        TEMPLATES.map((template) =>
          h(
            'button',
            {
              type: 'button',
              class: 'picker-option',
              disabled: state.locked || template.available === false,
              'data-template': template.id,
              onclick: () => choose(template.id),
            },
            h('span', { class: 'picker-icon', 'aria-hidden': 'true' }, template.icon),
            h('span', { class: 'picker-name' }, template.name),
            h('span', { class: 'picker-blurb' }, template.blurb),
          ),
        ),
      ),
      state.locked && h('p', { class: 'meta' }, '🔒 This note is locked. Unlock it to choose.'),
    ),
  )
}

function showUnsupported(id) {
  state.template = null
  state.view = null
  state.picker = null
  els.page.replaceChildren(
    h(
      'section',
      { class: 'picker' },
      h('h1', {}, 'Not supported yet'),
      h(
        'p',
        { class: 'meta' },
        `This note is set up as "${id}", which this version of Organizer can't show yet. Your text is safe: switch this note to the plain text editor to see it.`,
      ),
    ),
  )
}

/** Preview mode's `?demo` note; `?demo=notebook` shows a Notebook instead of Todos. */
function demoText() {
  const day = (offset) => addDays(todayIso(), offset)
  if (new URLSearchParams(location.search).get('demo') === 'notebook') {
    return [
      '<!-- organizer: notebook -->',
      '',
      '## Routine',
      `<!-- edited ${day(-1)} -->`,
      '',
      '### Evening',
      `<!-- edited ${day(-2)} -->`,
      '',
      '#### Wind-down list',
      `<!-- entry ${day(-2)} -->`,
      '- **No screens** after 10pm',
      '- [x] Blackout curtains',
      '- [ ] Try magnesium for two weeks',
      '',
      '### No caffeine after noon',
      `<!-- entry ${day(-1)} -->`,
      'Tried it for a week: fell asleep about 20 minutes sooner.',
      '',
      '### Morning light',
      `<!-- entry ${day(-3)} -->`,
      'Up at 7, daylight within the first hour. See [why light matters](https://example.com/light).',
      '',
      "## What the doctor said",
      `<!-- edited ${day(-40)} -->`,
      '',
      '### Appointment',
      `<!-- entry ${day(-40)} -->`,
      '> Sleep apnea is unlikely; keep a diary for a month.',
      '',
      '### Sleep diary',
      `<!-- entry ${day(-30)} -->`,
      'Bed 23:10, up 07:05, woke twice.',
      '',
      '## Ask Sam which sleep app he uses',
      `<!-- entry ${day(0)} -->`,
    ].join('\n')
  }
  return [
    '<!-- organizer: todos -->',
    '',
    `- [ ] Work out (${day(-30)}, every day, done ${day(-1)}, streak 6) #health`,
    `- [ ] Stretch (${day(-30)}, every mon wed fri)`,
    `- [ ] Renew passport (${day(-20)}, due ${day(-2)}, priority high) #admin`,
    `- [ ] Reply to Sam's email (${day(-1)})`,
    `- [ ] Learn to make sourdough (${day(-30)}) #personal`,
    '',
    '## Home',
    `- [ ] Call the plumber about the leak (${day(0)}, priority high, value high)`,
    `- [ ] Fix the garden gate (${day(-2)}, value high) #weekend`,
    '',
    '## Health',
    `- [ ] Book a dentist appointment (${day(-3)}, due ${day(5)})`,
    '',
    '## Parked',
    `- [ ] Clear out the garage (${day(-40)}, group Home)`,
    '',
    '## Done',
    `- [x] Buy milk (${day(-2)}, done ${day(-1)}, group Home)`,
  ].join('\n')
}

els.previewBanner.hidden = !host.isPreview
host.onNote(handleNote)
