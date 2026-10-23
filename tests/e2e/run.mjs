// Runs every browser check: serves the plugins and the fake Standard Notes host, then runs
// each suite in its own process. Exits non-zero if any check fails.
//
//   npm run test:browser
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import httpServer from 'http-server'
import { HOST, PLUGIN, SHOTS_DIR } from './support.mjs'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const SUITES = ['daily-journal.e2e.mjs', 'organizer.e2e.mjs', 'android-replay.e2e.mjs']

function serve(root, origin) {
  const server = httpServer.createServer({ root, cors: true, cache: -1, showDir: false, logFn: () => {} })
  return new Promise((resolve) => server.listen(Number(new URL(origin).port), 'localhost', () => resolve(server)))
}

mkdirSync(SHOTS_DIR, { recursive: true })
const servers = await Promise.all([serve(here('../../'), PLUGIN), serve(here('./harness/'), HOST)])

// Asynchronous on purpose: this process serves the pages the suites load, so it must not block.
const runSuite = (suite) =>
  new Promise((resolve) => spawn(process.execPath, [here(suite)], { stdio: 'inherit' }).on('exit', resolve))

let failed = false
for (const suite of SUITES) {
  console.log(`\n=== ${suite}`)
  failed ||= (await runSuite(suite)) !== 0
}

for (const server of servers) server.close()
console.log(failed ? '\nSome browser checks failed.' : '\nAll browser checks passed.')
process.exitCode = failed ? 1 : 0
