// End-to-end check of the plugin inside a fake Standard Notes host.
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { HOST, SHOTS_DIR, launchBrowser, wait } from './support.mjs'

const browser = await launchBrowser({ args: ['--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 1200 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`))
page.on('dialog', (dialog) => {
  errors.push(`dialog: ${dialog.message()}`)
  dialog.dismiss()
})

const results = []
async function check(name, fn) {
  try {
    await fn()
    results.push(`PASS  ${name}`)
  } catch (error) {
    results.push(`FAIL  ${name}\n      ${error.message.split('\n').join('\n      ')}`)
  }
}

async function open(query = '') {
  await page.goto(`${HOST}/index.html${query}`, { waitUntil: 'load' })
  const frame = await (await page.$('iframe')).contentFrame()
  await frame.waitForSelector('#journal:not([hidden])', { timeout: 5000 })
  return frame
}
const host = (fn, ...args) => page.evaluate(fn, ...args)
const value = (frame, selector) => frame.$eval(selector, (el) => el.value)
const text = (frame, selector) => frame.$eval(selector, (el) => el.textContent)

let frame = await open()

await check('renders an empty note dated from created_at, without saving', async () => {
  assert.equal(await text(frame, '#date-line'), 'October 20, 2026')
  assert.equal(await text(frame, '#weekday'), 'Tuesday')
  assert.equal(await value(frame, '#field-section-journal'), '')
  await wait(600)
  assert.equal(await host(() => harness.saves.length), 0)
})

await check('typing and picking a mood saves Markdown through the relay', async () => {
  await frame.type('#field-section-journal', 'Hello from the e2e test')
  await frame.click('[data-mood="great"]')
  await wait(900)
  const saved = await host(() => harness.notes.a.content)
  assert.equal(saved.text, '# Tuesday, October 20, 2026\nMood: 😄 Great\n\n## Journal\nHello from the e2e test')
  assert.equal(saved.preview_plain, '😄 Hello from the e2e test')
  assert.equal(saved.title, 'A')
  assert.equal(await text(frame, '#save-status'), 'Saved')
  assert.equal(await text(frame, '#word-count'), '5 / 250 words')
})

await check('answering the prompt saves its question and locks the shuffle', async () => {
  assert.equal(await frame.$eval('#another-prompt', (el) => el.disabled), false)
  await frame.click('#another-prompt')
  const question = (await text(frame, 'label[for="field-prompt"]')).replace('💭 ', '')
  await frame.type('#field-prompt', 'A good one')
  await wait(900)
  const saved = await host(() => harness.notes.a.content.text)
  assert.ok(saved.endsWith(`## 💭 ${question}\nA good one`), saved)
  assert.equal(await frame.$eval('#another-prompt', (el) => el.disabled), true)
})

await check('word goal is stored as component data', async () => {
  await frame.click('#goal-input', { clickCount: 3 })
  await frame.type('#goal-input', '100')
  await page.keyboard.press('Tab')
  await wait(100)
  assert.deepEqual(await host(() => harness.componentData), { wordGoal: 100 })
  assert.equal(await text(frame, '#word-count'), '8 / 100 words')
})

await check('switching notes flushes the pending save, then shows the new note', async () => {
  await frame.type('#field-section-focus', 'Pending focus')
  await host(() => harness.showNote('b'))
  await wait(200)
  assert.match(await host(() => harness.notes.a.content.text), /## Today's focus\nPending focus/)
  assert.equal(await text(frame, '#date-line'), 'October 21, 2026')
  assert.equal(await value(frame, '#field-section-journal'), 'Note B body')
  assert.equal(await value(frame, '#field-section-focus'), '')
  assert.equal(await frame.$eval('[data-mood="great"]', (el) => el.getAttribute('aria-pressed')), 'true')
  assert.equal(await text(frame, 'label[for="field-extra-0"]'), 'Dreams')
  assert.equal(await value(frame, '#field-extra-0'), 'Flying again')
})

await check('edits from elsewhere re-render; metadata updates do not', async () => {
  await host(() => harness.pushItem({ ...harness.notes.b, content: { ...harness.notes.b.content, text: '## Journal\nFrom another device' } }))
  await wait(100)
  assert.equal(await value(frame, '#field-section-journal'), 'From another device')
  await host(() =>
    harness.pushItem({ ...harness.notes.b, isMetadataUpdate: true, content: { ...harness.notes.b.content, text: 'ignored' } }),
  )
  await wait(100)
  assert.equal(await value(frame, '#field-section-journal'), 'From another device')
})

await check('locked notes are read-only and never save', async () => {
  const savesBefore = await host(() => harness.saves.length)
  await host(() =>
    harness.pushItem({
      ...harness.notes.b,
      content: {
        ...harness.notes.b.content,
        text: '## Journal\nFrom another device',
        appData: { 'org.standardnotes.sn': { locked: true } },
      },
    }),
  )
  await wait(100)
  assert.equal(await frame.$eval('#lock-badge', (el) => el.hidden), false)
  assert.equal(await frame.$eval('#field-section-journal', (el) => el.readOnly), true)
  assert.equal(await frame.$eval('[data-mood="bad"]', (el) => el.disabled), true)
  await frame.type('#field-section-journal', 'nope')
  await wait(700)
  assert.equal(await host(() => harness.saves.length), savesBefore)
  assert.equal(await value(frame, '#field-section-journal'), 'From another device')
})

const sample = [
  '# Wednesday, October 21, 2026',
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
  'Slow start, but the afternoon was good. Got the editor talking to Standard Notes and saw my first entry save.',
  '',
  '## 💭 What made you smile today?',
  'The dog stealing a sock and parading it around the flat.',
].join('\n')

frame = await open(`?dark&text=${encodeURIComponent(sample)}`)
await wait(300)
await check('dark theme from Standard Notes is applied', async () => {
  const background = await frame.$eval('body', (el) => getComputedStyle(el).backgroundColor)
  assert.equal(background, 'rgb(29, 30, 34)')
})
await (await page.$('iframe')).screenshot({ path: join(SHOTS_DIR, 'host-dark.png') })

await page.setViewport({ width: 380, height: 1200 })
frame = await open(`?w=360&text=${encodeURIComponent(sample)}`)
await wait(300)
await check('no horizontal overflow at phone width', async () => {
  const overflow = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.equal(overflow, 0)
})
await (await page.$('iframe')).screenshot({ path: join(SHOTS_DIR, 'host-narrow.png') })

await check('loading text is replaced once the note arrives', async () => {
  assert.equal(await frame.$eval('#loading', (el) => el.hidden), true)
})

await check('a host that never sends the note leaves "Loading", not a blank page', async () => {
  await page.goto(`${HOST}/index.html?noreply`, { waitUntil: 'load' })
  const stuck = await (await page.$('iframe')).contentFrame()
  await wait(1500)
  assert.equal(await stuck.$eval('#loading', (el) => !el.hidden && el.textContent), 'Loading Daily Journal…')
})

const ignorable = (line) => line.includes('/favicon.ico') || line.includes('status of 404 (Not Found)')
await check('no errors or alerts in the console', async () => {
  assert.deepEqual(errors.filter((line) => !ignorable(line)), [])
})

await browser.close()
console.log(results.join('\n'))
process.exitCode = results.some((line) => line.startsWith('FAIL')) ? 1 : 0
