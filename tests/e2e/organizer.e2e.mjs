// End-to-end checks of Organizer (Todos) inside the fake Standard Notes host.
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { HOST, PLUGIN, SHOTS_DIR, launchBrowser, wait } from './support.mjs'

const pad = (n) => String(n).padStart(2, '0')
const iso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const day = (offset) => {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return iso(date)
}
const TODAY = day(0)
const MARKER = '<!-- organizer: todos -->'

const browser = await launchBrowser({ args: ['--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 1000, height: 1200 })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
page.on('response', (response) => response.status() >= 400 && errors.push(`${response.status()} ${response.url()}`))

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
  await page.goto(`${HOST}/${extra.includes('mobile') ? 'mobile.html' : 'index.html'}?${query}${extra.replace('mobile', '')}`, {
    waitUntil: 'load',
  })
  await wait(300)
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${PLUGIN}/organizer`))
  await frame.waitForSelector('#page:not([hidden])', { timeout: 5000 })
  return frame
}
const hostFrame = () => page.frames().find((candidate) => candidate.url().startsWith(`${HOST}/index.html`))
const saved = () => hostFrame().evaluate(() => harness.notes.a.content)
const saveCount = () => hostFrame().evaluate(() => harness.saves.length)

const rowTexts = (frame, list = '.todo-area') =>
  frame.$$eval(`${list} .todo`, (rows) =>
    rows.map((row) => row.querySelector('.todo-text')?.value ?? row.querySelector('.todo-label')?.textContent),
  )
const inRow = (frame, startsWith, selector) =>
  frame.evaluate(
    (startsWith, selector) => {
      const row = [...document.querySelectorAll('.todo')].find((li) =>
        (li.querySelector('.todo-text')?.value ?? li.querySelector('.todo-label')?.textContent ?? '').startsWith(startsWith),
      )
      if (!row) throw new Error(`no row starting with ${startsWith}`)
      row.querySelector(selector).click()
    },
    startsWith,
    selector,
  )
const clickButton = (frame, label) =>
  frame.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === label)
    if (!button) throw new Error(`no button "${label}"`)
    button.click()
  }, label)
async function addTodo(frame, text) {
  await frame.$eval('.add-input', (input, text) => {
    input.value = text
  }, text)
  await clickButton(frame, 'Add')
}

let frame = await open()

await check('an empty note shows the picker and saves nothing', async () => {
  await frame.waitForSelector('.picker')
  assert.equal(await frame.$eval('[data-template="people"]', (el) => el.disabled), true)
  await wait(600)
  assert.equal(await saveCount(), 0)
})

await check('choosing Todos writes the marker', async () => {
  await frame.click('[data-template="todos"]')
  await frame.waitForSelector('.todos')
  await wait(900)
  const note = await saved()
  assert.equal(note.text, MARKER)
  assert.equal(note.preview_plain, 'No todos yet')
})

await check('adding a todo (Enter) saves it in the plain-text format', async () => {
  await frame.type('.add-input', 'Call the plumber #home')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Call the plumber (${TODAY}) #home`)
  assert.equal(await frame.$eval('.add-input', (el) => el.value), '', 'the box clears for the next one')
})

await check('pasting a list adds one todo per line', async () => {
  await addTodo(frame, '- [ ] Book flights\n2. Renew insurance #admin')
  await wait(900)
  const text = (await saved()).text
  assert.match(text, new RegExp(`- \\[ \\] Book flights \\(${TODAY}\\)`))
  assert.match(text, new RegExp(`- \\[ \\] Renew insurance \\(${TODAY}\\) #admin`))
  assert.equal((await rowTexts(frame)).length, 3)
})

await check('ticking a todo moves it to Done with the date', async () => {
  await inRow(frame, 'Book flights', '.todo-check')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`## Done\\n- \\[x\\] Book flights \\(${TODAY}, done ${TODAY}\\)`))
  assert.ok(!(await rowTexts(frame)).some((text) => text.startsWith('Book flights')))
})

await check('filters narrow the list, and todos added while filtered join the tag', async () => {
  await clickButton(frame, '#home')
  assert.deepEqual(await rowTexts(frame), ['Call the plumber #home'])
  await addTodo(frame, 'Fix the tap')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`- \\[ \\] Fix the tap \\(${TODAY}\\) #home`))
  await clickButton(frame, 'All')
  assert.equal((await rowTexts(frame)).length, 3)
})

await check('editing a todo in place saves as you type', async () => {
  await frame.evaluate(() => {
    const input = [...document.querySelectorAll('.todo-text')].find((el) => el.value.startsWith('Fix the tap'))
    input.focus()
    input.select()
  })
  await page.keyboard.type('Fix the kitchen tap #home')
  await wait(900)
  assert.match((await saved()).text, /- \[ \] Fix the kitchen tap \(.*\) #home/)
})

await check('parking from the actions menu', async () => {
  await inRow(frame, 'Call the plumber', '.icon-button')
  await clickButton(frame, 'Park')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`## Parked\\n- \\[ \\] Call the plumber \\(${TODAY}\\) #home`))
})

await check('deleting needs a second tap', async () => {
  await inRow(frame, 'Renew insurance', '.icon-button')
  await clickButton(frame, 'Delete')
  assert.ok((await rowTexts(frame)).some((text) => text.startsWith('Renew insurance')))
  await clickButton(frame, 'Tap again to delete')
  await wait(900)
  assert.doesNotMatch((await saved()).text, /Renew insurance/)
})

const STALE = [
  MARKER,
  '',
  `- [ ] old one (${day(-20)})`,
  '- [ ] typed on my phone',
  `- [ ] old but due (${day(-30)}, due ${day(10)})`,
].join('\n')

frame = await open(STALE)

await check('opening dates hand-typed todos and parks stale ones, saving at once', async () => {
  await wait(900)
  const text = (await saved()).text
  assert.match(text, new RegExp(`- \\[ \\] typed on my phone \\(${TODAY}\\)`))
  assert.match(text, new RegExp(`- \\[ \\] old but due \\(${day(-30)}, due ${day(10)}\\)`))
  assert.match(text, new RegExp(`## Parked\\n- \\[ \\] old one \\(${day(-20)}\\)`))
  assert.ok(await frame.$('.banner'), 'review banner shows')
})

await check('reviewing steps through parked todos and records the review', async () => {
  await clickButton(frame, 'Review')
  assert.equal(await frame.$eval('.review-text', (el) => el.textContent), 'old one')
  await clickButton(frame, 'Bring back')
  await wait(900)
  const text = (await saved()).text
  assert.ok(text.startsWith(`<!-- organizer: todos · reviewed ${TODAY} -->`), text.split('\n')[0])
  assert.match(text, new RegExp(`- \\[ \\] old one \\(${TODAY}\\)`))
  assert.equal(await frame.$('.banner'), null)
  assert.equal(await frame.$('.review'), null)
})

frame = await open(STALE)
await check('"Not now" snoozes the review for a week', async () => {
  await frame.waitForSelector('.banner')
  await clickButton(frame, 'Not now')
  await wait(900)
  assert.ok((await saved()).text.startsWith(`<!-- organizer: todos · reviewed ${TODAY} -->`))
  assert.equal(await frame.$('.banner'), null)
})

frame = await open(`${MARKER}\n\nBins go out on Tuesday\n- [ ] a (${TODAY})\n\n## Shopping\n- milk`)
await check('text that is not a todo is shown and kept; a typed heading becomes a group', async () => {
  assert.equal(await frame.$eval('.other-text', (el) => el.textContent), 'Bins go out on Tuesday')
  await frame.click('section[aria-label="Shopping"] .group-toggle')
  assert.deepEqual(await rowTexts(frame, 'section[aria-label="Shopping"]'), ['milk'])
  await addTodo(frame, 'b')
  await wait(900)
  assert.equal(
    (await saved()).text,
    `${MARKER}\n\n- [ ] b (${TODAY})\n- [ ] a (${TODAY})\n\n## Shopping\n- [ ] milk (${TODAY})\n\nBins go out on Tuesday`,
  )
})

frame = await open(`${MARKER}\n\n- [ ] ten days old (${day(-10)})`)
await check('a shorter stale period (a synced setting) parks sooner', async () => {
  assert.deepEqual(await rowTexts(frame), ['ten days old'])
  await frame.click('[aria-label="Settings"]')
  await frame.$eval('.number-field', (input) => {
    input.value = '7'
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(900)
  assert.deepEqual(await hostFrame().evaluate(() => harness.componentData), { staleDays: 7 })
  assert.match((await saved()).text, /## Parked\n- \[ \] ten days old/)
})

frame = await open('Shopping:\n- milk\n- [ ] eggs')
await check('an existing note keeps its text when it becomes a Todos note', async () => {
  assert.match(await frame.$eval('.picker', (el) => el.textContent), /existing text will be kept/)
  await frame.click('[data-template="todos"]')
  await wait(900)
  assert.equal(
    (await saved()).text,
    `${MARKER}\n\n- [ ] milk (${TODAY})\n- [ ] eggs (${TODAY})\n\nShopping:`,
  )
})

await check('a locked note is read-only but can still be filtered', async () => {
  const before = await saveCount()
  await hostFrame().evaluate(() =>
    harness.pushItem({
      ...harness.notes.a,
      content: { ...harness.notes.a.content, appData: { 'org.standardnotes.sn': { locked: true } } },
    }),
  )
  await wait(200)
  assert.equal(await frame.$eval('.add-input', (el) => el.disabled), true)
  assert.equal(await frame.$eval('.todo-check', (el) => el.disabled), true)
  assert.equal(await frame.$eval('.lock-badge', (el) => el.hidden), false)
  assert.equal(await frame.$eval('[aria-label="Settings"]', (el) => el.disabled), false)
  await wait(600)
  assert.equal(await saveCount(), before)
})

frame = await open(null, 'mobile')
await check('Android replay: loads and saves through an opaque-origin host', async () => {
  await frame.waitForSelector('.picker')
  await frame.click('[data-template="todos"]')
  await wait(900)
  assert.equal((await saved()).text, MARKER)
})

// Routine (repeating todos)
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const todayIndex = new Date().getDay()
const tomorrowIndex = (todayIndex + 1) % 7
const shortDay = (index) => DAY_NAMES[index].slice(0, 3).toLowerCase()
const weekOrder = (indexes) => [1, 2, 3, 4, 5, 6, 0].filter((index) => indexes.includes(index))

frame = await open(`${MARKER}\n\n- [ ] Work out (${TODAY})`)
await check('making a todo repeat every day moves it into the routine', async () => {
  await inRow(frame, 'Work out', '.icon-button')
  await clickButton(frame, 'Every day')
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Work out (${TODAY}, every day)`)
  assert.ok(await frame.$('.routine .todo'), 'shown under Routine')
})

await check('ticking a routine todo keeps it visible and crossed out; unticking undoes it', async () => {
  await inRow(frame, 'Work out', '.todo-check')
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [x] Work out (${TODAY}, every day, done ${TODAY}, streak 1)`)
  assert.ok(await frame.$('.routine .is-done-today'))
  assert.match(await frame.$eval('.routine .streak', (el) => el.textContent), /🔥 1 in a row/)
  assert.match(await frame.$eval('.routine .section-head .meta', (el) => el.textContent), /1 of 1 done today/)
  await inRow(frame, 'Work out', '.todo-check')
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Work out (${TODAY}, every day)`)
})

frame = await open(`${MARKER}\n\n- [ ] Work out (${day(-30)}, every day, done ${day(-1)}, streak 4) #health`)
await check('a streak carries on from yesterday, and old routine todos are never parked', async () => {
  await wait(600)
  assert.equal(await saveCount(), 0, 'nothing to change on open')
  assert.match(await frame.$eval('.routine .streak', (el) => el.textContent), /🔥 4 in a row/)
  await inRow(frame, 'Work out', '.todo-check')
  await wait(900)
  assert.equal(
    (await saved()).text,
    `${MARKER}\n\n- [x] Work out (${day(-30)}, every day, done ${TODAY}, streak 5) #health`,
  )
})

frame = await open(`${MARKER}\n\n- [ ] Work out (${day(-30)}, every day, done ${day(-3)}, streak 4)`)
await check('a missed day resets the streak when the note opens', async () => {
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Work out (${day(-30)}, every day, done ${day(-3)})`)
  assert.equal(await frame.$('.routine .streak'), null)
})

frame = await open(`${MARKER}\n\n- [ ] Stretch (${TODAY})`)
await check('choosing days starts with today, and more days can be added', async () => {
  await inRow(frame, 'Stretch', '.icon-button')
  await clickButton(frame, 'Choose days')
  await wait(100)
  assert.deepEqual(
    await frame.$$eval('.day[aria-pressed="true"]', (days) => days.map((day) => day.getAttribute('aria-label'))),
    [DAY_NAMES[todayIndex]],
  )
  await frame.click(`.day[aria-label="${DAY_NAMES[tomorrowIndex]}"]`)
  await wait(900)
  const days = weekOrder([todayIndex, tomorrowIndex]).map(shortDay).join(' ')
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Stretch (${TODAY}, every ${days})`)
})

frame = await open(`${MARKER}\n\n- [ ] Yoga (${TODAY}, every ${shortDay(tomorrowIndex)})`)
await check('routine todos not on today wait under "Not today"', async () => {
  assert.equal(await frame.$eval('.routine summary', (el) => el.textContent), 'Not today (1)')
  assert.match(await frame.$eval('.is-later .meta', (el) => el.textContent), new RegExp(`next on ${DAY_NAMES[tomorrowIndex]}`))
  assert.match(await frame.$eval('.routine .empty', (el) => el.textContent), /Nothing scheduled today/)
})

// Priority and value
const badges = (frame, startsWith) =>
  frame.evaluate((startsWith) => {
    const row = [...document.querySelectorAll('.todo')].find((li) =>
      (li.querySelector('.todo-text')?.value ?? li.querySelector('.todo-label')?.textContent ?? '').startsWith(startsWith),
    )
    return [...row.querySelectorAll('.badge')].map((badge) => badge.textContent)
  }, startsWith)

frame = await open(`${MARKER}\n\n- [ ] Plain one (${TODAY})\n- [ ] Book flights (${day(-1)})`)
await check('rating priority saves it and shows a label; Sort all then moves it up', async () => {
  assert.equal(await frame.$('.chips'), null, 'no filter buttons until something is rated')
  assert.deepEqual(await rowTexts(frame), ['Plain one', 'Book flights'])
  await inRow(frame, 'Book flights', '.icon-button')
  await frame.click('[aria-label="High priority"]')
  await wait(900)
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Plain one (${TODAY})\n- [ ] Book flights (${TODAY}, priority high)`)
  assert.deepEqual(await rowTexts(frame), ['Plain one', 'Book flights'], 'your order stays until you sort')
  assert.deepEqual(await badges(frame, 'Book flights'), ['High priority'])
  await clickButton(frame, 'Sort all')
  await wait(900)
  assert.deepEqual(await rowTexts(frame), ['Book flights', 'Plain one'])
  assert.equal((await saved()).text, `${MARKER}\n\n- [ ] Book flights (${TODAY}, priority high)\n- [ ] Plain one (${TODAY})`)
})

await check('value can be rated too, and both show as labels', async () => {
  await frame.click('[aria-label="Low value"]')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`- \\[ \\] Book flights \\(${TODAY}, priority high, value low\\)`))
  assert.deepEqual(await badges(frame, 'Book flights'), ['High priority', 'Low value'])
  await frame.click('[aria-label="Value not rated"]')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`- \\[ \\] Book flights \\(${TODAY}, priority high\\)`))
})

await check('the High priority filter shows just those, and todos added while filtered get rated', async () => {
  await clickButton(frame, 'High priority')
  assert.deepEqual(await rowTexts(frame), ['Book flights'])
  await addTodo(frame, 'Pay the electricity bill')
  await wait(900)
  assert.match((await saved()).text, new RegExp(`- \\[ \\] Pay the electricity bill \\(${TODAY}, priority high\\)`))
  assert.equal((await rowTexts(frame)).length, 2)
  await clickButton(frame, 'All')
  assert.equal((await rowTexts(frame)).length, 3)
})

frame = await open(`${MARKER}\n\n## Parked\n- [ ] Learn Spanish (${day(-40)}, value high)`)
await check('the weekly review shows a parked todo\'s ratings', async () => {
  await clickButton(frame, 'Review')
  assert.deepEqual(await frame.$$eval('.review .badge', (els) => els.map((el) => el.textContent)), ['High value'])
})

// Groups and rearranging
const GROUPS = [
  MARKER,
  '',
  `- [ ] Reply to Sam (${TODAY})`,
  '',
  '## Home',
  `- [ ] Call the plumber (${TODAY})`,
  `- [ ] Fix the tap (${TODAY})`,
  '',
  '## Trip',
  `- [ ] Book flights (${TODAY})`,
  '',
  '## Parked',
  `- [ ] Clear out the garage (${day(-40)}, group Home)`,
].join('\n')
const inSection = (frame, name) => rowTexts(frame, `.todo-area section[aria-label="${name}"]`)
const savedSection = async (name) => {
  const text = (await saved()).text
  const match = new RegExp(`## ${name}\\n((?:- .*\\n?)*)`).exec(text)
  return match ? match[1].trim().split('\n').map((line) => line.replace(/^- \[.\] /, '').replace(/ \(.*$/, '')) : null
}
async function drag(frame, fromText, toText, half = 'top') {
  const rowFor = (text) =>
    frame.evaluateHandle(
      (text) =>
        [...document.querySelectorAll('.todo-area .todo')].find((li) => li.querySelector('.todo-text').value.startsWith(text)),
      text,
    )
  const handle = await (await rowFor(fromText)).asElement().$('.drag-handle')
  const from = await handle.boundingBox()
  const to = await (await rowFor(toText)).asElement().boundingBox()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * (half === 'top' ? 0.25 : 0.75), { steps: 10 })
  await page.mouse.up()
}

frame = await open(GROUPS)
await check('groups start collapsed, showing their counts', async () => {
  assert.deepEqual(await inSection(frame, 'Home'), [])
  assert.equal(await frame.$eval('section[aria-label="Home"] .group-toggle', (el) => el.getAttribute('aria-expanded')), 'false')
  assert.equal(await frame.$eval('section[aria-label="Home"] .group-count', (el) => el.textContent), '2')
  assert.deepEqual(await inSection(frame, 'To do'), ['Reply to Sam'], 'ungrouped todos always show')
})

await check('the "Groups start" setting switches to expanded, and syncs', async () => {
  await frame.click('[aria-label="Settings"]')
  await clickButton(frame, 'Expanded')
  await wait(200)
  assert.deepEqual(await hostFrame().evaluate(() => harness.componentData), { groupsStart: 'expanded' })
  assert.equal((await inSection(frame, 'Home')).length, 2)
  await frame.click('[aria-label="Settings"]')
})

await check('groups show as sections, in the note\'s order', async () => {
  assert.deepEqual(await inSection(frame, 'To do'), ['Reply to Sam'])
  assert.deepEqual(await inSection(frame, 'Home'), ['Call the plumber', 'Fix the tap'])
  assert.deepEqual(await inSection(frame, 'Trip'), ['Book flights'])
  assert.equal(await frame.$eval('section[aria-label="Home"] .group-count', (el) => el.textContent), '2')
})

await check('arrow keys on a drag handle move a todo within its group', async () => {
  await frame.focus('[aria-label^="Move Fix the tap"]')
  await page.keyboard.press('ArrowUp')
  await wait(900)
  assert.deepEqual(await inSection(frame, 'Home'), ['Fix the tap', 'Call the plumber'])
  assert.deepEqual(await savedSection('Home'), ['Fix the tap', 'Call the plumber'])
  assert.equal(
    await frame.evaluate(() => document.activeElement.getAttribute('aria-label')),
    'Move Fix the tap: drag, or use the arrow keys',
    'focus stays on the handle',
  )
})

await check('dragging a todo into another group', async () => {
  await drag(frame, 'Reply to Sam', 'Book flights', 'top')
  await wait(900)
  assert.deepEqual(await inSection(frame, 'Trip'), ['Reply to Sam', 'Book flights'])
  assert.deepEqual(await inSection(frame, 'To do'), [])
  assert.deepEqual(await savedSection('Trip'), ['Reply to Sam', 'Book flights'])
})

await check('dragging within a group, below another todo', async () => {
  await drag(frame, 'Fix the tap', 'Call the plumber', 'bottom')
  await wait(900)
  assert.deepEqual(await savedSection('Home'), ['Call the plumber', 'Fix the tap'])
})

await check('the menu moves a todo to another group (at the top) and to the bottom', async () => {
  await inRow(frame, 'Book flights', '.icon-button')
  await frame.$eval('.todo-actions select', (select) => {
    select.value = 'Home'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await wait(900)
  assert.deepEqual(await savedSection('Home'), ['Book flights', 'Call the plumber', 'Fix the tap'])
  await clickButton(frame, 'To bottom')
  await wait(900)
  assert.deepEqual(await savedSection('Home'), ['Call the plumber', 'Fix the tap', 'Book flights'])
})

await check('adding straight into a group puts the todo at its top', async () => {
  await frame.click('[aria-label="Add a todo to Home"]')
  assert.equal(await frame.evaluate(() => document.activeElement.getAttribute('data-focus')), 'add-Home')
  await page.keyboard.type('Buy a washer')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.deepEqual((await savedSection('Home'))[0], 'Buy a washer')
  assert.equal(await frame.evaluate(() => document.activeElement.getAttribute('data-focus')), 'add-Home', 'ready for the next one')
  await page.keyboard.press('Escape')
})

await check('a new group is saved as a heading and opens for adding', async () => {
  await clickButton(frame, '+ New group')
  await page.keyboard.type('Garden')
  await page.keyboard.press('Enter')
  await wait(900)
  assert.match((await saved()).text, /## Garden\n\n## Parked/)
  assert.equal(await frame.evaluate(() => document.activeElement.getAttribute('data-focus')), 'add-Garden')
  await page.keyboard.press('Escape')
})

await check('renaming a group: reserved names are refused, parked todos follow the new name', async () => {
  await frame.click('[aria-label="More actions for group Home"]')
  await clickButton(frame, 'Rename')
  await frame.$eval('.group-rename', (input) => input.select())
  await page.keyboard.type('Done')
  await page.keyboard.press('Enter')
  assert.match(await frame.$eval('.error', (el) => el.textContent), /reserved/)
  await frame.$eval('.group-rename', (input) => input.select())
  await page.keyboard.type('House')
  await page.keyboard.press('Enter')
  await wait(900)
  const text = (await saved()).text
  assert.match(text, /## House\n- \[ \] Buy a washer/)
  assert.match(text, /Clear out the garage \(.*, group House\)/)
})

await check('collapsing a group hides its todos', async () => {
  await frame.click('section[aria-label="House"] .group-toggle')
  assert.deepEqual(await inSection(frame, 'House'), [])
  assert.equal(await frame.$eval('section[aria-label="House"] .group-count', (el) => el.textContent), '4')
  await frame.click('section[aria-label="House"] .group-toggle')
  assert.equal((await inSection(frame, 'House')).length, 4)
})

await check('a parked todo shows its group, and comes back to the top of it', async () => {
  assert.match(await frame.$eval('.is-parked .meta', (el) => el.textContent), /in House/)
  await inRow(frame, 'Clear out the garage', '.button')
  await wait(900)
  assert.equal((await savedSection('House'))[0], 'Clear out the garage')
})

await check('deleting a group takes two taps and keeps its todos, ungrouped', async () => {
  await frame.click('[aria-label="More actions for group Trip"]')
  await clickButton(frame, 'Delete group')
  assert.ok((await saved()).text.includes('## Trip'))
  await clickButton(frame, 'Tap again: its todos become ungrouped')
  await wait(900)
  const text = (await saved()).text
  assert.ok(!text.includes('## Trip'))
  assert.deepEqual(await inSection(frame, 'To do'), ['Reply to Sam'])
})

frame = await open(`${MARKER}\n\n## Home\n- [ ] Fix the tap (${TODAY}) #weekend\n- [ ] Pay the bill (${day(-5)}, due ${day(-1)})`)
await check('a collapsed group shows its overdue count; filters and + open it', async () => {
  assert.equal(await frame.$eval('section[aria-label="Home"] .group-overdue', (el) => el.textContent), '1 overdue')
  assert.deepEqual(await inSection(frame, 'Home'), [])
  await clickButton(frame, '#weekend')
  assert.deepEqual(await inSection(frame, 'Home'), ['Fix the tap #weekend'])
  await clickButton(frame, 'All')
  assert.deepEqual(await inSection(frame, 'Home'), [], 'closed again without the filter')
  await frame.click('[aria-label="Add a todo to Home"]')
  assert.equal((await inSection(frame, 'Home')).length, 2)
  assert.equal(await frame.evaluate(() => document.activeElement.getAttribute('data-focus')), 'add-Home')
})

// Screenshots of a realistic list.
const DEMO = [
  MARKER,
  '',
  `- [x] Work out (${day(-30)}, every day, done ${TODAY}, streak 7) #health`,
  `- [ ] Read 20 pages (${day(-30)}, every day, done ${day(-1)}, streak 3)`,
  `- [ ] Yoga (${day(-30)}, every ${shortDay(tomorrowIndex)})`,
  `- [ ] Renew passport (${day(-20)}, due ${day(-2)}) #admin`,
  `- [ ] Reply to Sam's email (${day(-1)})`,
  '',
  '## Home',
  `- [ ] Call the plumber about the leak (${TODAY}, priority high, value high)`,
  `- [ ] Draft the garden plan (${day(-2)}, value high)`,
  `- [ ] Sort old photos (${day(-1)}, priority low, value low)`,
  '',
  '## Health',
  `- [ ] Book a dentist appointment (${day(-3)}, due ${day(5)})`,
  '',
  '## Parked',
  `- [ ] Clear out the garage (${day(-40)}) #home`,
  `- [ ] Learn to make sourdough (${day(-30)}) #personal`,
  '',
  '## Done',
  `- [x] Buy milk (${day(-2)}, done ${day(-1)}) #home`,
].join('\n')

frame = await open(DEMO)
await inRow(frame, 'Reply to Sam', '.icon-button')
await (await page.$('iframe')).screenshot({ path: join(SHOTS_DIR, 'organizer-light.png') })
frame = await open(DEMO, '&dark')
await check('dark theme applies', async () => {
  assert.equal(await frame.$eval('body', (el) => getComputedStyle(el).backgroundColor), 'rgb(29, 30, 34)')
})
await clickButton(frame, 'Review')
await (await page.$('iframe')).screenshot({ path: join(SHOTS_DIR, 'organizer-dark.png') })
await page.setViewport({ width: 380, height: 1200 })
frame = await open(DEMO, '&w=360')
await check('no horizontal overflow at phone width', async () => {
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0)
})
await (await page.$('iframe')).screenshot({ path: join(SHOTS_DIR, 'organizer-narrow.png') })

await check('no errors in the console', async () => {
  assert.deepEqual(
    errors.filter((line) => !line.includes('/favicon.ico') && !line.includes('status of 404 (Not Found)')),
    [],
  )
})

await browser.close()
console.log(results.join('\n'))
process.exitCode = results.some((line) => line.startsWith('FAIL')) ? 1 : 0
