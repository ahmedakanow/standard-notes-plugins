import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { relayWindowFor } from '../src/hosts.js'

// Runs the vendored ComponentRelay, exactly as the page loads it, against a fake window.
function loadRelay() {
  const code = readFileSync(new URL('../vendor/component-relay.js', import.meta.url), 'utf8')
  const context = {
    self: {},
    window: { console },
    document: { referrer: '' },
    crypto,
    setTimeout,
    clearTimeout,
    console,
    URL,
    btoa,
  }
  vm.runInNewContext(code, context)
  return context.self.ComponentRelay
}

function fakeWindow() {
  const listeners = []
  const sent = []
  const win = {
    document: {
      title: 'Daily Journal',
      addEventListener() {},
      removeEventListener() {},
      getElementsByTagName: () => [{ appendChild() {} }],
      getElementsByClassName: () => [],
    },
    addEventListener: (type, handler) => type === 'message' && listeners.push(handler),
    removeEventListener() {},
    parent: {
      postMessage(message, targetOrigin) {
        sent.push({ message: typeof message === 'string' ? JSON.parse(message) : message, targetOrigin })
      },
    },
  }
  const receive = (origin, message) => listeners.forEach((handler) => handler({ origin, data: message }))
  return { win, sent, receive }
}

function register(environment) {
  return {
    action: 'component-registered',
    sessionKey: 'session-1',
    data: { uuid: 'component-1', environment, platform: 'android', activeThemeUrls: [] },
  }
}

const ComponentRelay = loadRelay()

test('asks for the note through "*" when Standard Notes has an opaque origin (Android app)', () => {
  const { win, sent, receive } = fakeWindow()
  const relay = new ComponentRelay({ targetWindow: relayWindowFor(win) })
  relay.streamContextItem(() => {})

  receive('null', JSON.stringify(register('mobile')))

  const request = sent.find(({ message }) => message.action === 'stream-context-item')
  assert.ok(request, 'the relay never asked Standard Notes for the note')
  assert.equal(request.targetOrigin, '*')
})

test('keeps addressing a normal Standard Notes origin exactly', () => {
  const { win, sent, receive } = fakeWindow()
  const relay = new ComponentRelay({ targetWindow: relayWindowFor(win) })
  relay.streamContextItem(() => {})

  receive('https://app.standardnotes.com', register('web'))

  const request = sent.find(({ message }) => message.action === 'stream-context-item')
  assert.equal(request?.targetOrigin, 'https://app.standardnotes.com')
})
