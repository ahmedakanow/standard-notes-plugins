// The two places the journal can run. Inside Standard Notes it talks to the app
// through ComponentRelay. Opened directly in a browser it runs in preview mode,
// keeping a single note in localStorage so the UI can be tried without the app.

import { formatDateHeading, toIsoDate } from './journal.js'

export function createHost() {
  return window.parent !== window ? createRelayHost() : createPreviewHost()
}

/**
 * The window ComponentRelay talks through. The Standard Notes mobile apps run from file://,
 * so their messages arrive from origin "null". Relay 2.2.2 then replies with targetOrigin
 * "null", which postMessage rejects, and the plugin never receives its note. An opaque
 * origin can't be named, so reply with '*' in that case only. (Fixed upstream in
 * component-relay b728107, which isn't published to npm.)
 */
export function relayWindowFor(win) {
  return {
    document: win.document,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    parent: {
      postMessage: (message, targetOrigin) =>
        win.parent.postMessage(message, targetOrigin === 'null' ? '*' : targetOrigin),
    },
  }
}

function createRelayHost() {
  const relay = new window.ComponentRelay({
    targetWindow: relayWindowFor(window),
    options: { coallesedSaving: true, coallesedSavingDelay: 400 },
  })
  return {
    isPreview: false,
    onNote: (callback) => relay.streamContextItem(callback),
    save: (note, presave, onSaved) => relay.saveItemWithPresave(note, presave, onSaved),
    getSetting: (key) => relay.getComponentDataValueForKey(key),
    setSetting(key, value) {
      try {
        relay.setComponentDataValueForKey(key, value)
      } catch {
        // The relay throws until this plugin has stored data once, so start it off empty.
        relay.clearComponentData()
        relay.setComponentDataValueForKey(key, value)
      }
    },
  }
}

const PREVIEW_NOTE_KEY = 'daily-journal:preview-note'
const PREVIEW_SETTINGS_KEY = 'daily-journal:preview-settings'

function createPreviewHost() {
  const params = new URLSearchParams(location.search)
  if (params.has('reset')) remove(PREVIEW_NOTE_KEY)
  const note = (params.has('demo') ? demoNote() : load(PREVIEW_NOTE_KEY)) ?? emptyNote()
  const settings = load(PREVIEW_SETTINGS_KEY) ?? {}
  let saveTimer

  return {
    isPreview: true,
    onNote: (callback) => setTimeout(() => callback(note)),
    save(item, presave, onSaved) {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        presave()
        store(PREVIEW_NOTE_KEY, item)
        onSaved?.()
      }, 400)
    },
    getSetting: (key) => settings[key],
    setSetting(key, value) {
      settings[key] = value
      store(PREVIEW_SETTINGS_KEY, settings)
    },
  }
}

function emptyNote(text = '') {
  return { uuid: 'preview-note', created_at: new Date().toISOString(), content: { text } }
}

function demoNote() {
  return emptyNote(
    [
      `# ${formatDateHeading(toIsoDate(new Date()))}`,
      'Mood: 🙂 Good',
      '',
      '## Grateful for',
      'Morning coffee on the balcony',
      'A friend who checked in out of the blue',
      '',
      "## Today's focus",
      'Finish the first version of my journal plugin.',
      '',
      '## Journal',
      'Slow start, but the afternoon was good. Got the editor talking to Standard Notes and saw my first entry save. Small thing, but it felt like a real milestone.',
    ].join('\n'),
  )
}

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key))
  } catch {
    return null
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private windows, blocked site data); preview still works in memory.
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    // See store().
  }
}
