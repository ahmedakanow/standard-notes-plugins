// The two places a plugin can run. Inside Standard Notes it talks to the app through
// ComponentRelay. Opened directly in a browser it runs in preview mode, keeping a single
// note in localStorage so the UI can be tried without the app.

/**
 * @param {object} options
 * @param {string} options.name  Namespaces preview storage; plugins share an origin on GitHub Pages.
 * @param {() => string} [options.demoText]  Note text for preview mode's `?demo`.
 */
export function createHost({ name, demoText = () => '' }) {
  return window.parent !== window ? createRelayHost() : createPreviewHost(name, demoText)
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

function createPreviewHost(name, demoText) {
  const noteKey = `${name}:preview-note`
  const settingsKey = `${name}:preview-settings`
  const params = new URLSearchParams(location.search)
  if (params.has('reset')) remove(noteKey)
  const note = (params.has('demo') ? emptyNote(demoText()) : load(noteKey)) ?? emptyNote()
  const settings = load(settingsKey) ?? {}
  let saveTimer

  return {
    isPreview: true,
    onNote: (callback) => setTimeout(() => callback(note)),
    save(item, presave, onSaved) {
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        presave()
        store(noteKey, item)
        onSaved?.()
      }, 400)
    },
    getSetting: (key) => settings[key],
    setSetting(key, value) {
      settings[key] = value
      store(settingsKey, settings)
    },
  }
}

function emptyNote(text = '') {
  return { uuid: 'preview-note', created_at: new Date().toISOString(), content: { text } }
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
