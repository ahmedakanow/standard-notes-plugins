// Shared setup for the browser checks: which browser to drive, where things are served,
// and a tiny pass/fail reporter. run.mjs starts both servers before the suites run.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

// The plugins (repo root) and the fake Standard Notes host (harness/) are served on
// ports of their own, so the checks don't clash with `npm start` on 8001.
export const PLUGIN = 'http://localhost:8101'
export const HOST = 'http://localhost:8102'
export const SHOTS_DIR = fileURLToPath(new URL('./screenshots/', import.meta.url))

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
]

export function launchBrowser(options = {}) {
  const executablePath = BROWSERS.find((path) => path && existsSync(path))
  if (!executablePath) throw new Error('No Chrome or Edge found. Set CHROME_PATH to one.')
  return puppeteer.launch({ executablePath, headless: true, ...options })
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
