// Replays the Android trace (opaque "null" host origin, JSON-string messages, no referrer)
// and reports GREEN only if the note renders and an edit saves back to the host.
import { HOST, PLUGIN, launchBrowser, wait } from './support.mjs'

// Optional replay variant, e.g. `?objects` or `?nothemes` (see harness/index.html).
const query = process.argv[2] ?? ''

const browser = await launchBrowser()
const page = await browser.newPage()
const exceptions = []
page.on('pageerror', (error) => exceptions.push(error.message.split('\n')[0]))
await page.goto(`${HOST}/mobile.html${query}`, { waitUntil: 'load' })
await wait(1500)

const plugin = page.frames().find((frame) => frame.url().startsWith(`${PLUGIN}`))
const host = page.frames().find((frame) => frame.url().startsWith(`${HOST}/index.html`))
const rendered = await plugin.$eval('#journal', (el) => !el.hidden)

let saved = ''
if (rendered) {
  await plugin.type('#field-section-journal', 'typed on android')
  await wait(900)
  saved = await host.evaluate(() => harness.notes.a.content.text)
}
await browser.close()

console.log(`exceptions: ${exceptions.length}\n  ${exceptions.join('\n  ')}`)
const green = rendered && saved.includes('typed on android')
console.log(green ? 'GREEN: note rendered and the edit saved' : `RED: ${rendered ? 'rendered but did not save' : 'stuck on "Loading"'}`)
process.exitCode = green ? 0 : 1
