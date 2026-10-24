// End-to-end checks of Organizer's Notebook template inside the fake Standard Notes host.
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { HOST, PLUGIN, SHOTS_DIR, launchBrowser, wait } from './support.mjs'

const pad = (n) => String(n).padStart(2, '0')
const TODAY = (() => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
})()
const MARKER = '<!-- organizer: notebook -->'
const EDITED = `<!-- edited ${TODAY} -->`
const ENTRY = `<!-- entry ${TODAY} -->`

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

async function open(text = null, extra = '') {
  const query = new URLSearchParams({ plugin: 'organizer' })
  if (text !== null) query.set('text', text)
  const file = extra.includes('mobile') ? 'mobile.html' : 'index.html'
  await page.goto(`${HOST}/${file}?${query}${extra.replace('mobile', '')}`, { waitUntil: 'load' })
  await wait(300)
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${PLUGIN}/organizer`))
  await frame.waitForSelector('#page:not([hidden])', { timeout: 5000 })
  return frame
}
const hostFrame = () => page.frames().find((candidate) => candidate.url().startsWith(`${HOST}/index.html`))
const saved = async () => (await hostFrame().evaluate(() => harness.notes.a.content.text)) ?? ''
const saveCount = () => hostFrame().evaluate(() => harness.saves.length)
const clickButton = (frame, label) =>
  frame.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === label)
    if (!button) throw new Error(`no button "${label}"`)
    button.click()
  }, label)
// Opens a section or an entry from the contents, or from an Arrange-mode row.
const openRow = (frame, title) =>
  frame.evaluate((title) => {
    const row = [...document.querySelectorAll('.toc-entry, .nb-open')].find(
      (button) => button.querySelector('.toc-title, .nb-row-title').textContent === title,
    )
    if (!row) throw new Error(`nothing called "${title}" to open`)
    row.click()
  }, title)
const rowMenu = (frame, title) => frame.click(`[aria-label="More actions for ${title}"]`)
// Adds a section or an entry by typing its name, as you would.
async function add(frame, kind, name) {
  await clickButton(frame, `+ Add ${kind}`)
  await page.keyboard.type(name)
  await page.keyboard.press('Enter')
  await wait(900)
}
const setValue = (frame, selector, value) =>
  frame.$eval(
    selector,
    (field, value) => {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    },
    value,
  )
const text = (frame, selector) => frame.$eval(selector, (el) => el.textContent)
const texts = (frame, selector) => frame.$$eval(selector, (els) => els.map((el) => el.textContent))
// What a page lists (or, in Arrange mode, its rows), and what's indented under its sections.
const contents = (frame) => texts(frame, '.nb-page .nb-contents > .toc > .level-1 > .toc-entry .toc-title, .nb-page .nb-contents .nb-row-title')
const subContents = (frame) => texts(frame, '.nb-page .nb-contents .level-2 > .toc-entry .toc-title')
const crumbs = (frame) => texts(frame, '.nb-crumbs .crumb')
const pickTarget = (frame, title) =>
  frame.evaluate((title) => [...document.querySelectorAll('.nb-move-target')].find((b) => b.textContent === title).click(), title)

let frame = await open()

await check('choosing Notebook writes the marker and starts blank', async () => {
  await frame.click('[data-template="notebook"]')
  await frame.waitForSelector('.notebook')
  await wait(900)
  assert.equal(await saved(), MARKER)
  assert.deepEqual(await texts(frame, '.nb-add-row button'), ['+ Add entry', '+ Add section'])
  assert.equal(await frame.$('.nb-contents'), null, 'nothing listed yet')
  assert.equal(await frame.$('.nb-page .nb-title'), null, 'no title: Standard Notes shows the name')
})

await check('adding a section and an entry takes just a name, and stays on the list', async () => {
  await add(frame, 'section', 'Sleep')
  await add(frame, 'entry', 'Ask Sam about his app')
  assert.equal(await saved(), `${MARKER}\n\n## Sleep\n${EDITED}\n\n## Ask Sam about his app\n${ENTRY}`)
  assert.deepEqual(await contents(frame), ['Sleep', 'Ask Sam about his app'], 'sections first, then entries')
  assert.equal(await frame.$('.nb-crumbs'), null, 'still on the front page')
  assert.deepEqual(await texts(frame, '.nb-add-row button'), ['+ Add entry', '+ Add section', 'Arrange'], 'Arrange once there is something')
  assert.equal(await frame.$('.nb-contents h2'), null, 'no Contents heading')
})

await check('a section holds entries and sections of its own, with a trail back', async () => {
  await openRow(frame, 'Sleep')
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Sleep')
  assert.deepEqual(await crumbs(frame), ['A'])
  await add(frame, 'entry', 'Tips')
  await add(frame, 'section', 'Evening')
  assert.equal(await saved(), `${MARKER}\n\n## Sleep\n${EDITED}\n\n### Evening\n${EDITED}\n\n### Tips\n${ENTRY}\n\n## Ask Sam about his app\n${ENTRY}`)
  assert.deepEqual(await contents(frame), ['Evening', 'Tips'])
})

await check('an entry opens on its own page, and Add text gives it text', async () => {
  await openRow(frame, 'Tips')
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Tips')
  assert.deepEqual(await crumbs(frame), ['A', 'Sleep'])
  await clickButton(frame, 'Add text')
  await setValue(frame, '.nb-editor', '- No coffee after 2pm\n- [ ] Buy blackout curtains')
  await clickButton(frame, 'Done')
  await wait(900)
  assert.match(await saved(), new RegExp(`### Tips\\n${ENTRY}\\n- No coffee after 2pm\\n- \\[ \\] Buy blackout curtains\\n`))
  assert.equal(await frame.$$eval('.md li', (els) => els.length), 2, 'the list is formatted')
})

await check('ticking a checklist item while reading saves it, by its box or its words', async () => {
  await frame.click('.md input[type="checkbox"]')
  await wait(900)
  assert.match(await saved(), /- \[x\] Buy blackout curtains/)
  await frame.evaluate(() => [...document.querySelectorAll('.md-check label')].at(-1).click())
  await wait(900)
  assert.match(await saved(), /- \[ \] Buy blackout curtains/)
})

await check('typing saves after a pause, and the toolbar formats the selection', async () => {
  await clickButton(frame, 'Edit')
  await frame.$eval('.nb-editor', (field) => {
    const at = field.value.indexOf('No coffee')
    field.setSelectionRange(at, at + 'No coffee'.length)
  })
  await frame.click('[aria-label="Bold"]')
  await page.keyboard.press('End')
  await page.keyboard.type(' (or tea)')
  await wait(700)
  assert.doesNotMatch(await saved(), /or tea/, 'not saved while typing')
  await wait(2200)
  assert.match(await saved(), /- \*\*No coffee\*\* after 2pm \(or tea\)/)
  await clickButton(frame, 'Done')
  assert.equal(await text(frame, '.md li strong'), 'No coffee')
})

await check('the toolbar numbers lines and underlines', async () => {
  await clickButton(frame, 'Edit')
  await setValue(frame, '.nb-editor', 'Rest well\nSleep early')
  await frame.$eval('.nb-editor', (field) => field.setSelectionRange(0, field.value.length))
  await frame.click('[aria-label="Numbered list"]')
  await frame.$eval('.nb-editor', (field) => {
    const at = field.value.indexOf('well')
    field.setSelectionRange(at, at + 'well'.length)
  })
  await frame.click('[aria-label="Underline"]')
  await clickButton(frame, 'Done')
  await wait(900)
  assert.match(await saved(), /\n1\. Rest <u>well<\/u>\n2\. Sleep early\n/)
  assert.equal(await frame.$$eval('.md ol li', (els) => els.length), 2)
  assert.equal(await text(frame, '.md u'), 'well')
})

await check('HTML in a note is shown as text and never runs', async () => {
  await clickButton(frame, 'Edit')
  await setValue(frame, '.nb-editor', 'Hi <img src=x onerror="window.__hacked = 1"> <script>window.__hacked = 2</script>')
  await clickButton(frame, 'Done')
  await wait(300)
  assert.equal(await frame.$('.md img, .md script'), null)
  assert.equal(await frame.evaluate(() => window.__hacked), undefined)
  assert.match(await text(frame, '.md'), /<img src=x/)
})

await check('search finds names and text, and opens the entry with the match marked', async () => {
  await clickButton(frame, 'Edit')
  await setValue(frame, '.nb-editor', '- [x] Buy blackout curtains')
  await clickButton(frame, 'Done')
  await frame.click('.nb-search')
  await page.keyboard.type('curtains')
  assert.equal(await text(frame, '.nb-row.is-result .nb-row-title'), 'Tips')
  assert.equal(await text(frame, '.nb-row.is-result .meta'), 'Sleep')
  await frame.click('.nb-row.is-result .nb-open')
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Tips')
  assert.equal(await text(frame, '.md mark'), 'curtains')
})

await check('the contents show what is inside each section, and each entry\'s first line', async () => {
  await clickButton(frame, 'Sleep')
  assert.equal(await text(frame, '.toc-preview'), 'Buy blackout curtains')
  await clickButton(frame, 'A')
  assert.deepEqual(await subContents(frame), ['Evening', 'Tips'])
  assert.match(await text(frame, '.level-1 > .toc-entry .toc-meta'), /^[A-Z][a-z]{2} \d{1,2}$/, 'edited date after the leader')
})

await check('renaming and moving an entry from its menu', async () => {
  await openRow(frame, 'Tips')
  await rowMenu(frame, 'Tips')
  await clickButton(frame, 'Rename')
  await frame.$eval('.nb-rename', (input) => input.select())
  await page.keyboard.type('Sleep tips')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.match(await saved(), /### Sleep tips\n<!-- entry /)
  await rowMenu(frame, 'Sleep tips')
  await clickButton(frame, 'Move…')
  assert.deepEqual(await texts(frame, '.nb-move-target'), ['A', 'Evening'], 'the front page, named after the note, comes first')
  await pickTarget(frame, 'A')
  await wait(900)
  assert.match(await saved(), /## Ask Sam about his app\n<!-- entry .* -->\n\n## Sleep tips\n<!-- entry .* -->\n- \[x\] Buy blackout curtains$/)
  assert.deepEqual(await crumbs(frame), ['A'])
})

await check('deleting (in Arrange) takes two taps', async () => {
  await clickButton(frame, 'A')
  assert.equal(await frame.$('[aria-label="More actions for Sleep"]'), null, 'the contents have no row menus')
  await clickButton(frame, 'Arrange')
  await rowMenu(frame, 'Sleep')
  await clickButton(frame, 'Delete')
  assert.match(await saved(), /## Sleep\n/)
  await clickButton(frame, 'Tap again to delete it and 1 inside')
  await wait(900)
  assert.doesNotMatch(await saved(), /## Sleep\n|Evening/)
  assert.deepEqual(await contents(frame), ['Ask Sam about his app', 'Sleep tips'])
  await clickButton(frame, 'Done arranging')
  assert.equal(await frame.$('.nb-row'), null)
})

frame = await open(`${MARKER}\n\n## One\n\n## Two\n\n## Three\n\n## Note x\n<!-- entry -->\n\n## Note y\n<!-- entry -->`)
await check('reordering in Arrange, by dragging and with the arrow keys', async () => {
  await clickButton(frame, 'Arrange')
  const handle = await frame.$('[aria-label^="Move Three"]')
  const target = await frame.evaluateHandle(() =>
    [...document.querySelectorAll('.nb-row')].find((row) => row.querySelector('.nb-row-title').textContent === 'One'),
  )
  const from = await handle.boundingBox()
  const to = await target.asElement().boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.25, { steps: 10 })
  await page.mouse.up()
  await wait(900)
  const entries = '## Note x\n<!-- entry -->\n\n## Note y\n<!-- entry -->'
  assert.equal(await saved(), `${MARKER}\n\n## Three\n\n## One\n\n## Two\n\n${entries}`)
  await frame.focus('[aria-label^="Move Two"]')
  await page.keyboard.press('ArrowUp')
  await wait(900)
  assert.equal(await saved(), `${MARKER}\n\n## Three\n\n## Two\n\n## One\n\n${entries}`)
  await frame.focus('[aria-label^="Move Note y"]')
  await page.keyboard.press('ArrowUp')
  await wait(900)
  assert.match(await saved(), /## Note y\n<!-- entry -->\n\n## Note x\n<!-- entry -->$/)
})

frame = await open(`${MARKER}\n\n## One\n<!-- entry -->\nFirst words`)
await check('switching notes while typing saves the typing to the right note first', async () => {
  await openRow(frame, 'One')
  await clickButton(frame, 'Edit')
  await page.keyboard.press('End')
  await page.keyboard.type(', typed just before switching')
  await hostFrame().evaluate(() => harness.showNote('b'))
  await wait(900)
  assert.match(await saved(), /## One\n<!-- entry .* -->\nFirst words, typed just before switching$/)
  assert.doesNotMatch(await hostFrame().evaluate(() => harness.notes.b.content.text), /typed just before/)
})

// Notes from 0.9.0 and before: unnamed text under sections and at the top.
frame = await open(
  [
    MARKER,
    'About sleep.',
    '',
    '<!-- entry 2026-10-22 -->',
    'Ask Sam',
    '',
    '## Routine',
    '<!-- edited 2026-10-20 -->',
    'What works.',
    '',
    '<!-- entry 2026-10-21 -->',
    'No caffeine after noon',
  ].join('\n'),
)
await check('an older notebook is converted when opened, keeping all the text', async () => {
  await wait(900)
  assert.equal(
    await saved(),
    [
      MARKER,
      '',
      '## Routine',
      '<!-- edited 2026-10-20 -->',
      '',
      '### What works.',
      '<!-- entry 2026-10-20 -->',
      'What works.',
      '',
      '### No caffeine after noon',
      '<!-- entry 2026-10-21 -->',
      'No caffeine after noon',
      '',
      '## About sleep.',
      '<!-- entry -->',
      'About sleep.',
      '',
      '## Ask Sam',
      '<!-- entry 2026-10-22 -->',
      'Ask Sam',
    ].join('\n'),
  )
  assert.deepEqual(await contents(frame), ['Routine', 'About sleep.', 'Ask Sam'])
})

const DEMO = [
  MARKER,
  '',
  '## Routine',
  EDITED,
  '',
  '### Evening',
  EDITED,
  '',
  '#### Wind-down list',
  ENTRY,
  '- **No screens** after 10pm',
  '- [x] Blackout curtains',
  '- [ ] Try magnesium for two weeks',
  '',
  '### No caffeine after noon',
  ENTRY,
  'Tried it for a week: fell asleep about 20 minutes sooner.',
  '',
  '### Morning light',
  ENTRY,
  'Up at 7, daylight within the first hour. See [why light matters](https://example.com/light).',
  '',
  '## What the doctor said',
  EDITED,
  '',
  '### Appointment',
  ENTRY,
  '> Sleep apnea is unlikely; keep a diary for a month.',
  '',
  '### Sleep diary',
  ENTRY,
  'Bed 23:10, up 07:05, woke twice.',
  '',
  '## Ask Sam which sleep app he uses',
  ENTRY,
].join('\n')

frame = await open(DEMO)
await check('opening an existing notebook saves nothing', async () => {
  await wait(600)
  assert.equal(await saveCount(), 0)
})

await check('wide screens show everything as a tree beside the page', async () => {
  assert.ok(await frame.$('.nb-tree'))
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-wide-front.png') })
  await frame.evaluate(() => [...document.querySelectorAll('.nb-tree-link')].find((b) => b.textContent === 'Routine').click())
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Routine')
  assert.deepEqual(
    await texts(frame, '.nb-tree-link'),
    ['Routine', 'Evening', 'No caffeine after noon', 'Morning light', 'What the doctor said', 'Ask Sam which sleep app he uses'],
    'the open section expands in the tree, entries included',
  )
  await openRow(frame, 'Evening')
  await openRow(frame, 'Wind-down list')
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-wide.png') })
})

await check('a locked notebook can be read and searched, but not changed', async () => {
  const before = await saveCount()
  await hostFrame().evaluate(() =>
    harness.pushItem({
      ...harness.notes.a,
      content: { ...harness.notes.a.content, appData: { 'org.standardnotes.sn': { locked: true } } },
    }),
  )
  await wait(200)
  assert.equal(await frame.$eval('.md input[type="checkbox"]', (el) => el.disabled), true)
  assert.equal(await frame.$eval('.nb-search', (el) => el.disabled), false)
  assert.equal(await frame.$eval('.crumb', (el) => el.disabled), false)
  assert.equal(await frame.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Edit').disabled), true)
  await wait(600)
  assert.equal(await saveCount(), before)
})

await page.setViewport({ width: 380, height: 1200 })
frame = await open(DEMO, '&w=360')
await check('phones get one column, without the tree', async () => {
  assert.equal(await frame.$('.nb-tree'), null)
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-narrow.png') })
  await openRow(frame, 'Routine')
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-narrow-section.png') })
  await openRow(frame, 'No caffeine after noon')
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-narrow-entry.png') })
})

await page.setViewport({ width: 1000, height: 1200 })
frame = await open(DEMO, '&dark')
await check('dark theme applies', async () => {
  assert.equal(await frame.$eval('body', (el) => getComputedStyle(el).backgroundColor), 'rgb(29, 30, 34)')
  await openRow(frame, 'Routine')
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-dark.png') })
})

frame = await open(DEMO, 'mobile')
await check('Android replay: reads and saves through an opaque-origin host', async () => {
  await clickButton(frame, '+ Add entry')
  await page.keyboard.type('Thought from my phone')
  await page.keyboard.press('Enter')
  await wait(900)
  const sandboxedHost = page.frames().find((candidate) => candidate.url().startsWith(`${HOST}/index.html`))
  assert.match(
    await sandboxedHost.evaluate(() => harness.notes.a.content.text),
    /## Ask Sam which sleep app he uses\n<!-- entry .* -->\n\n## Thought from my phone\n<!-- entry .* -->$/,
  )
})

await check('no errors in the console', async () => {
  assert.deepEqual(
    errors.filter((line) => !line.includes('/favicon.ico') && !line.includes('status of 404 (Not Found)')),
    [],
  )
})

await browser.close()
console.log(results.join('\n'))
process.exitCode = results.some((line) => line.startsWith('FAIL')) ? 1 : 0
