import { createHost } from './hosts.js'
import {
  MOODS,
  SECTIONS,
  countEntryWords,
  describeDate,
  parseEntry,
  previewFor,
  promptForDate,
  serializeEntry,
  toIsoDate,
} from './journal.js'

const WORD_GOAL_KEY = 'wordGoal'
const DEFAULT_WORD_GOAL = 250

const $ = (id) => document.getElementById(id)
const els = {
  loading: $('loading'),
  previewBanner: $('preview-banner'),
  journal: $('journal'),
  statusbar: $('statusbar'),
  weekday: $('weekday'),
  dateLine: $('date-line'),
  dateInput: $('date-input'),
  lockBadge: $('lock-badge'),
  moods: $('moods'),
  sections: $('sections'),
  progress: $('progress'),
  progressBar: $('progress-bar'),
  wordCount: $('word-count'),
  goalInput: $('goal-input'),
  saveStatus: $('save-status'),
}

const host = createHost()

const state = {
  note: null, // latest copy of the note from the host
  entry: null, // the parsed journal entry being edited
  lastText: '', // note text as last loaded or saved, to tell outside edits from our own
  dirty: false, // edits not yet confirmed saved
  locked: false,
  promptOffset: 0, // "Another prompt" clicks for this note
}

function handleNote(note) {
  const isNewNote = state.note?.uuid !== note.uuid
  state.note = note
  state.locked = Boolean(note.content?.appData?.['org.standardnotes.sn']?.locked)

  const text = note.content?.text ?? ''
  // While we have unsaved edits our save wins, so don't overwrite what's being typed.
  const isOutsideEdit = !note.isMetadataUpdate && text !== state.lastText && !state.dirty
  if (!isNewNote && !isOutsideEdit) {
    applyLock()
    return
  }

  state.entry = parseEntry(text)
  state.entry.date ??= toIsoDate(note.created_at ? new Date(note.created_at) : new Date())
  state.lastText = text
  state.dirty = false
  if (isNewNote) {
    state.promptOffset = 0
    setStatus('')
  }
  render({ keepFocus: !isNewNote })
}

function queueSave() {
  if (state.locked) return
  const { note, entry } = state
  state.dirty = true
  setStatus('Saving…')
  host.save(
    note,
    () => {
      const text = serializeEntry(entry)
      note.content.text = text
      note.content.preview_plain = previewFor(entry)
      note.content.preview_html = null
      state.lastText = text
    },
    () => {
      const isCurrent = state.note.uuid === note.uuid && serializeEntry(state.entry) === state.lastText
      if (!isCurrent) return
      state.dirty = false
      setStatus('Saved')
    },
  )
}

function render({ keepFocus }) {
  const focus = keepFocus ? captureFocus() : null
  els.loading.hidden = true
  els.journal.hidden = false
  els.statusbar.hidden = false
  renderDate()
  renderMoods()
  renderSections()
  renderWordCount()
  applyLock()
  restoreFocus(focus)
}

function renderDate() {
  const { weekday, long } = describeDate(state.entry.date)
  els.weekday.textContent = weekday
  els.dateLine.textContent = long
  els.dateInput.value = state.entry.date
}

function buildMoodButtons() {
  for (const mood of MOODS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mood-option'
    button.dataset.mood = mood.id
    const emoji = document.createElement('span')
    emoji.className = 'mood-emoji'
    emoji.setAttribute('aria-hidden', 'true')
    emoji.textContent = mood.emoji
    button.append(emoji, mood.label)
    els.moods.append(button)
  }
}

function renderMoods() {
  for (const button of els.moods.children) {
    button.setAttribute('aria-pressed', String(button.dataset.mood === state.entry.mood))
  }
}

function renderSections() {
  const { entry } = state
  const fields = []
  if (entry.preamble) {
    fields.push(createField({ key: 'preamble', label: 'Notes', value: entry.preamble }))
  }
  for (const section of SECTIONS) {
    fields.push(
      createField({
        key: `section:${section.id}`,
        label: section.heading,
        value: entry.sections[section.id],
        placeholder: section.placeholder,
        rows: section.rows,
      }),
    )
  }
  fields.push(createPromptField())
  entry.extras.forEach((extra, index) => {
    fields.push(createField({ key: `extra:${index}`, label: extra.heading, value: extra.body }))
  })
  els.sections.replaceChildren(...fields)
  autosizeAll()
}

function createField({ key, label, value, placeholder = '', rows = 3, action = null }) {
  const id = `field-${key.replace(':', '-')}`
  const section = document.createElement('section')
  section.className = 'entry-section'

  const header = document.createElement('div')
  header.className = 'section-header'
  const labelEl = document.createElement('label')
  labelEl.className = 'section-label'
  labelEl.htmlFor = id
  labelEl.textContent = label
  header.append(labelEl)
  if (action) header.append(action)

  const textarea = document.createElement('textarea')
  Object.assign(textarea, { id, value, placeholder, rows })
  textarea.dataset.field = key
  textarea.spellcheck = state.note.content?.spellcheck !== false

  section.append(header, textarea)
  return section
}

function createPromptField() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'text-button'
  button.id = 'another-prompt'
  button.textContent = 'Another prompt'
  const field = createField({
    key: 'prompt',
    label: promptLabel(),
    value: state.entry.prompt.answer,
    placeholder: 'Write as much or as little as you like…',
    action: button,
  })
  field.classList.add('is-prompt')
  return field
}

function currentQuestion() {
  return state.entry.prompt.question ?? promptForDate(state.entry.date, state.promptOffset)
}

function promptLabel() {
  return `💭 ${currentQuestion()}`
}

function updatePrompt() {
  els.sections.querySelector('label[for="field-prompt"]').textContent = promptLabel()
  // Only offer a new question while this one is unanswered.
  $('another-prompt').disabled = state.locked || state.entry.prompt.answer.trim() !== ''
}

function setField(key, value) {
  const { entry } = state
  const [kind, id] = key.split(':')
  if (kind === 'section') entry.sections[id] = value
  else if (kind === 'extra') entry.extras[Number(id)].body = value
  else if (kind === 'preamble') entry.preamble = value
  else if (kind === 'prompt') {
    // Pin the question being answered so it is saved with the entry.
    entry.prompt.question = currentQuestion()
    entry.prompt.answer = value
    updatePrompt()
  }
}

function wordGoal() {
  const stored = host.getSetting(WORD_GOAL_KEY)
  return Number.isInteger(stored) && stored >= 0 ? stored : DEFAULT_WORD_GOAL
}

function renderWordCount() {
  const words = countEntryWords(state.entry)
  const goal = wordGoal()
  const percent = goal > 0 ? Math.min(100, Math.round((words / goal) * 100)) : 0
  els.wordCount.textContent =
    goal > 0 ? `${words} / ${goal} words` : `${words} ${words === 1 ? 'word' : 'words'}`
  els.progress.hidden = goal === 0
  els.progress.setAttribute('aria-valuenow', String(percent))
  els.progress.classList.toggle('is-complete', goal > 0 && words >= goal)
  els.progressBar.style.width = `${percent}%`
  if (document.activeElement !== els.goalInput) els.goalInput.value = String(goal)
}

function applyLock() {
  const { locked } = state
  els.lockBadge.hidden = !locked
  els.dateInput.disabled = locked
  for (const button of els.moods.children) button.disabled = locked
  for (const textarea of els.sections.querySelectorAll('textarea')) textarea.readOnly = locked
  updatePrompt()
}

function setStatus(text) {
  els.saveStatus.textContent = text
}

function autosize(textarea) {
  // Collapsing to measure can shrink the page for a moment; keep the scroll position.
  const scroller = document.scrollingElement
  const scrollTop = scroller.scrollTop
  const borders = textarea.offsetHeight - textarea.clientHeight
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight + borders}px`
  scroller.scrollTop = scrollTop
}

function autosizeAll() {
  els.sections.querySelectorAll('textarea').forEach(autosize)
}

function captureFocus() {
  const active = document.activeElement
  if (!active?.dataset?.field) return null
  return { key: active.dataset.field, start: active.selectionStart, end: active.selectionEnd }
}

function restoreFocus(focus) {
  const textarea = focus && els.sections.querySelector(`[data-field="${focus.key}"]`)
  if (!textarea) return
  textarea.focus({ preventScroll: true })
  textarea.setSelectionRange(focus.start, focus.end)
}

els.moods.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mood]')
  if (!button || state.locked) return
  state.entry.mood = state.entry.mood === button.dataset.mood ? null : button.dataset.mood
  renderMoods()
  queueSave()
})

els.sections.addEventListener('input', (event) => {
  const textarea = event.target
  if (!textarea.dataset.field || state.locked) return
  setField(textarea.dataset.field, textarea.value)
  autosize(textarea)
  renderWordCount()
  queueSave()
})

els.sections.addEventListener('click', (event) => {
  if (!event.target.closest('#another-prompt') || state.locked) return
  state.entry.prompt.question = null
  state.promptOffset += 1
  updatePrompt()
})

els.dateInput.addEventListener('change', () => {
  if (!els.dateInput.value || state.locked) return
  state.entry.date = els.dateInput.value
  renderDate()
  updatePrompt()
  queueSave()
})

els.goalInput.addEventListener('change', () => {
  host.setSetting(WORD_GOAL_KEY, Math.max(0, Math.round(Number(els.goalInput.value) || 0)))
  renderWordCount()
})

let resizeFrame = 0
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(autosizeAll)
})

buildMoodButtons()
els.previewBanner.hidden = !host.isPreview
host.onNote(handleNote)
