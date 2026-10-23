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
// Opens a section from the contents page, an Arrange-mode row or an Unsorted slip.
const openRow = (frame, title) =>
  frame.evaluate((title) => {
    const entry = [...document.querySelectorAll('.toc-entry, .nb-open, .nb-slip-open')].find(
      (button) => (button.querySelector('.toc-title, .nb-row-title') ?? button).textContent === title,
    )
    if (!entry) throw new Error(`no section "${title}" to open`)
    entry.click()
  }, title)
const rowMenu = (frame, title) => frame.click(`[aria-label="More actions for ${title}"]`)
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
// Top-level entries of the page's contents (or, in Arrange mode, its rows).
const contents = (frame) =>
  frame.$$eval('.nb-page .nb-contents > .toc > .level-1 > .toc-entry .toc-title, .nb-page .nb-contents .nb-row-title', (els) =>
    els.map((el) => el.textContent),
  )
const subContents = (frame) =>
  frame.$$eval('.nb-page .nb-contents .level-2 > .toc-entry .toc-title', (els) => els.map((el) => el.textContent))
const slips = (frame) => frame.$$eval('.nb-unsorted .nb-slip-open', (els) => els.map((el) => el.textContent))

const PASTED = ['Sleep', 'I sleep badly.', '', '# Tips', '- No coffee after 2pm', '- [ ] Buy blackout curtains'].join('\n')

let frame = await open()

await check('choosing Notebook writes the marker and shows the empty notebook', async () => {
  await frame.click('[data-template="notebook"]')
  await frame.waitForSelector('.notebook')
  await wait(900)
  assert.equal(await saved(), MARKER)
  assert.equal(await text(frame, '.nb-page .nb-title'), 'A', 'named after the note')
  assert.match(await text(frame, '.nb-contents .empty'), /No sections yet/)
})

await check('a thought goes into Unsorted, which appears at the top', async () => {
  await frame.click('[data-focus="thought"]')
  await page.keyboard.type('Try magnesium')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.equal(await saved(), `${MARKER}\n\n## Unsorted\n${EDITED}\n<!-- entry ${TODAY} -->\nTry magnesium`)
  assert.deepEqual(await slips(frame), ['Try magnesium'])
})

await check('pasting a note makes a section, and its headings become sections inside it', async () => {
  await clickButton(frame, '+ Add section')
  await setValue(frame, '[data-focus="add-top"]', PASTED)
  await clickButton(frame, 'Add section')
  await wait(900)
  assert.ok(
    (await saved()).endsWith(
      `## Sleep\n${EDITED}\n<!-- entry ${TODAY} -->\nI sleep badly.\n\n### Tips\n${EDITED}\n<!-- entry ${TODAY} -->\n- No coffee after 2pm\n- [ ] Buy blackout curtains`,
    ),
    await saved(),
  )
  assert.deepEqual(await contents(frame), ['Sleep'])
  assert.deepEqual(await subContents(frame), ['Tips'], 'the contents show two levels')
  assert.equal(await text(frame, '.toc-preview'), 'I sleep badly.')
  assert.match(await text(frame, '.level-1 > .toc-entry .toc-meta'), /^[A-Z][a-z]{2} \d{1,2}$/, 'edited date after the leader')
})

await check('opening sections, with a trail back', async () => {
  await openRow(frame, 'Sleep')
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Sleep')
  assert.deepEqual(await contents(frame), ['Tips'])
  await openRow(frame, 'Tips')
  assert.deepEqual(await frame.$$eval('.nb-crumbs .crumb', (els) => els.map((el) => el.textContent)), ['A', 'Sleep'])
  assert.equal(await frame.$$eval('.md li', (els) => els.length), 2, 'the list is formatted')
  await clickButton(frame, 'Sleep')
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Sleep')
  await openRow(frame, 'Tips')
})

await check('ticking a checklist item while reading saves it, by its box or its words', async () => {
  await frame.click('.md input[type="checkbox"]')
  await wait(900)
  assert.match(await saved(), /- \[x\] Buy blackout curtains/)
  await frame.evaluate(() => [...document.querySelectorAll('.md-check label')].at(-1).click())
  await wait(900)
  assert.match(await saved(), /- \[ \] Buy blackout curtains/)
  await frame.click('.md input[type="checkbox"]')
  await wait(900)
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

await check('HTML in a note is shown as text and never runs', async () => {
  await clickButton(frame, 'Edit')
  await setValue(frame, '.nb-editor', 'Hi <img src=x onerror="window.__hacked = 1"> <script>window.__hacked = 2</script>')
  await clickButton(frame, 'Done')
  await wait(300)
  assert.equal(await frame.$('.md img, .md script'), null)
  assert.equal(await frame.evaluate(() => window.__hacked), undefined)
  assert.match(await text(frame, '.md'), /<img src=x/)
})

await check('search finds text, and opens the section with the match marked', async () => {
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

await check('renaming and moving from the menu', async () => {
  await rowMenu(frame, 'Tips')
  await clickButton(frame, 'Rename')
  await frame.$eval('.nb-rename', (input) => input.select())
  await page.keyboard.type('Sleep tips')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.match(await saved(), /### Sleep tips\n/)
  await rowMenu(frame, 'Sleep tips')
  await clickButton(frame, 'Move…')
  await clickButton(frame, 'Top level')
  await wait(900)
  assert.match(await saved(), /\n## Sleep tips\n/)
  assert.deepEqual(await frame.$$eval('.nb-crumbs .crumb', (els) => els.map((el) => el.textContent)), ['A'])
})

await check('filing a thought from Unsorted', async () => {
  await clickButton(frame, 'A')
  await frame.click('[aria-label="File Try magnesium"]')
  assert.match(await text(frame, '.nb-move .meta'), /^File "Try magnesium" under:$/)
  await frame.evaluate(() => [...document.querySelectorAll('.nb-move-target')].find((b) => b.textContent === 'Sleep').click())
  await wait(900)
  assert.match(await saved(), /## Sleep\n<!-- edited .* -->\n<!-- entry .* -->\nI sleep badly\.\n\n<!-- entry .* -->\nTry magnesium/)
  assert.equal(await frame.$('.nb-unsorted'), null, 'Unsorted is empty, so it hides')
})

await check('deleting (in Arrange) takes two taps', async () => {
  assert.equal(await frame.$('[aria-label="More actions for Sleep"]'), null, 'the contents page has no row menus')
  await clickButton(frame, 'Arrange')
  await rowMenu(frame, 'Sleep')
  await clickButton(frame, 'Delete')
  assert.match(await saved(), /## Sleep\n/)
  await clickButton(frame, 'Tap again to delete')
  await wait(900)
  assert.doesNotMatch(await saved(), /## Sleep\n|Try magnesium/)
  assert.deepEqual(await contents(frame), ['Sleep tips'])
  await clickButton(frame, 'Done arranging')
  assert.equal(await frame.$('.nb-row'), null)
})

frame = await open(`${MARKER}\n\n## One\nFirst words\n\n## Two\n\n## Three`)
await check('reordering sections in Arrange, by dragging and with the arrow keys', async () => {
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
  assert.equal(await saved(), `${MARKER}\n\n## Three\n\n## One\nFirst words\n\n## Two`)
  await frame.focus('[aria-label^="Move Two"]')
  await page.keyboard.press('ArrowUp')
  await wait(900)
  assert.equal(await saved(), `${MARKER}\n\n## Three\n\n## Two\n\n## One\nFirst words`)
})

await check('switching notes while typing saves the typing to the right note first', async () => {
  await openRow(frame, 'One')
  await clickButton(frame, 'Edit')
  await page.keyboard.press('End')
  await page.keyboard.type(', typed just before switching')
  await hostFrame().evaluate(() => harness.showNote('b'))
  await wait(900)
  assert.match(await saved(), /## One\n<!-- edited .* -->\nFirst words, typed just before switching$/)
  assert.doesNotMatch(await hostFrame().evaluate(() => harness.notes.b.content.text), /typed just before/)
})

// Entries: several unnamed pieces of text in one section
const entryMenu = (frame, words) => frame.click(`[aria-label="More actions for \\"${words}\\""]`)
const entryTexts = (frame) => frame.$$eval('.nb-entry .md', (els) => els.map((el) => el.textContent.trim()))

frame = await open(`${MARKER}\n\n## Sleep\nFirst thought\n\n## Exercise`)
await check('adding an entry puts it after the others, and the contents count them', async () => {
  await openRow(frame, 'Sleep')
  await clickButton(frame, '+ Add entry')
  await setValue(frame, '.nb-add textarea', 'Second thought')
  await clickButton(frame, 'Add entry')
  await wait(900)
  assert.equal(await saved(), `${MARKER}\n\n## Sleep\n${EDITED}\nFirst thought\n\n<!-- entry ${TODAY} -->\nSecond thought\n\n## Exercise`)
  assert.deepEqual(await entryTexts(frame), ['First thought', 'Second thought'])
  assert.match(await text(frame, '.nb-entry:last-child .nb-added'), /^Added [A-Z][a-z]{2} \d{1,2}$/)
  await clickButton(frame, 'A')
  assert.equal(await text(frame, '.toc-count'), '2 entries')
})

await check('moving an entry up keeps the entries apart in the text', async () => {
  await openRow(frame, 'Sleep')
  await entryMenu(frame, 'Second thought')
  await clickButton(frame, 'Move up')
  await wait(900)
  assert.deepEqual(await entryTexts(frame), ['Second thought', 'First thought'])
  assert.match(await saved(), /## Sleep\n<!-- edited .* -->\n<!-- entry .* -->\nSecond thought\n\n<!-- entry -->\nFirst thought/)
})

await check('moving an entry to another section', async () => {
  await entryMenu(frame, 'First thought')
  await clickButton(frame, 'Move to…')
  await frame.evaluate(() => [...document.querySelectorAll('.nb-move-target')].find((b) => b.textContent === 'Exercise').click())
  await wait(900)
  assert.deepEqual(await entryTexts(frame), ['Second thought'])
  assert.match(await saved(), /## Exercise\n<!-- edited .* -->\nFirst thought$/)
})

await check('an entry can become a section inside this one', async () => {
  await entryMenu(frame, 'Second thought')
  await clickButton(frame, 'Make it a section')
  await wait(900)
  assert.deepEqual(await entryTexts(frame), [])
  assert.deepEqual(await contents(frame), ['Second thought'])
  assert.match(await saved(), /## Sleep\n<!-- edited .* -->\n\n### Second thought\n<!-- edited .* -->\n\n## Exercise/)
})

await check('emptying an entry removes it, and deleting one takes two taps', async () => {
  await clickButton(frame, 'A')
  await openRow(frame, 'Exercise')
  await clickButton(frame, '+ Add entry')
  await setValue(frame, '.nb-add textarea', 'Run on Sunday')
  await clickButton(frame, 'Add entry')
  await entryMenu(frame, 'First thought')
  await clickButton(frame, 'Delete')
  assert.deepEqual(await entryTexts(frame), ['First thought', 'Run on Sunday'], 'one tap only asks')
  await clickButton(frame, 'Tap again to delete')
  await frame.evaluate(() => [...document.querySelectorAll('.nb-entry button')].find((b) => b.textContent === 'Edit').click())
  await setValue(frame, '.nb-editor', '   ')
  await clickButton(frame, 'Done')
  await wait(900)
  assert.deepEqual(await entryTexts(frame), [])
  assert.match(await saved(), /## Exercise\n<!-- edited .* -->$/)
})

const DEMO = [
  MARKER,
  'Everything about sleeping better, in one place.',
  '',
  '## Unsorted',
  '### Ask Sam which sleep app he uses',
  EDITED,
  '',
  '## Routine',
  EDITED,
  'What seems to work, roughly in order of how much it helps.',
  '',
  `<!-- entry ${TODAY} -->`,
  'Tried **no caffeine after noon** for a week: fell asleep about 20 minutes sooner.',
  '',
  '### Evening',
  EDITED,
  '- **No screens** after 10pm',
  '- [x] Blackout curtains',
  '- [ ] Try magnesium for two weeks',
  '',
  '### Morning',
  'Up at 7, daylight within the first hour. See [why light matters](https://example.com/light).',
  '',
  '## What the doctor said',
  '> Sleep apnea is unlikely; keep a diary for a month.',
  '',
  '### Sleep diary',
  'Bed 23:10, up 07:05, woke twice.',
].join('\n')

frame = await open(DEMO)
await check('opening an existing notebook saves nothing', async () => {
  await wait(600)
  assert.equal(await saveCount(), 0)
})

await check('wide screens show the tree beside the page', async () => {
  assert.ok(await frame.$('.nb-tree'))
  await frame.evaluate(() => [...document.querySelectorAll('.nb-tree-link')].find((b) => b.textContent === 'Routine').click())
  assert.equal(await text(frame, '.nb-page .nb-title'), 'Routine')
  assert.deepEqual(
    await frame.$$eval('.nb-tree-link', (els) => els.map((el) => el.textContent)),
    ['Unsorted', 'Routine', 'Evening', 'Morning', 'What the doctor said'],
    'the open section expands in the tree',
  )
  await openRow(frame, 'Evening')
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
  await openRow(frame, 'Evening')
  await page.screenshot({ path: join(SHOTS_DIR, 'notebook-narrow-section.png') })
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
  await frame.click('[data-focus="thought"]')
  await page.keyboard.type('Thought from my phone')
  await page.keyboard.press('Enter')
  await wait(900)
  const sandboxedHost = page.frames().find((candidate) => candidate.url().startsWith(`${HOST}/index.html`))
  assert.match(
    await sandboxedHost.evaluate(() => harness.notes.a.content.text),
    /## Unsorted\n<!-- edited .* -->\n<!-- entry .* -->\nThought from my phone\n\n### Ask Sam which sleep app he uses/,
    'the thought is an entry, and the older thought-section stays',
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
