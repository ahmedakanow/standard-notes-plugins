// Loads hosted plugins in preview mode (?demo) and checks they render without errors.
import { launchBrowser } from './support.mjs'

const BASE = 'https://ahmedakanow.github.io/standard-notes-plugins'
const PLUGINS = [
  { path: 'daily-journal', ready: '#journal:not([hidden])', probe: () => document.querySelector('#date-line').textContent },
  { path: 'organizer', ready: '.todos', probe: () => `${document.querySelectorAll('.todo').length} todos shown` },
  {
    path: 'organizer',
    demo: 'notebook',
    ready: '.notebook',
    probe: () => `notebook with ${document.querySelectorAll('.nb-row').length} sections shown`,
  },
]

const browser = await launchBrowser()
let failed = false
for (const plugin of PLUGINS) {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => response.status() >= 400 && !response.url().endsWith('/favicon.ico') && errors.push(`${response.status()} ${response.url()}`))
  try {
    await page.goto(`${BASE}/${plugin.path}/index.html?demo=${plugin.demo ?? ''}&nocache=${Date.now()}`, {
      waitUntil: 'networkidle0',
    })
    await page.waitForSelector(plugin.ready, { timeout: 10000 })
    const relay = await page.evaluate(() => typeof window.ComponentRelay)
    console.log(`${plugin.path}: rendered (${await page.evaluate(plugin.probe)}), relay ${relay}, errors: ${errors.length ? errors.join('; ') : 'none'}`)
    failed ||= errors.length > 0 || relay !== 'function'
  } catch (error) {
    console.log(`${plugin.path}: FAILED ${error.message} ${errors.join('; ')}`)
    failed = true
  }
  await page.close()
}
await browser.close()
process.exitCode = failed ? 1 : 0
