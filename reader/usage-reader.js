#!/usr/bin/env node
// usage-reader: reads every Claude Code transcript on this computer, evaluates the usage, and opens a report.
//
//   usage-reader              scan, write the report, open it in the browser
//   usage-reader --watch      keep rescanning every minute; the open page reloads itself
//   usage-reader --no-open    write the report without opening it
//   usage-reader --offline    skip the live plan reading
//   usage-reader --out FILE   write the report somewhere else
//   usage-reader --json       print the report data instead of writing a page

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { scanAll, claudeHome } from './scan.js'
import { evaluate } from './evaluate.js'
import { savedPlan, livePlan } from './plan.js'
import { renderPage } from './page.js'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const home = claudeHome()
const dir = path.join(home, 'usage-reader')
const outFile = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(dir, 'report.html')
const watch = flag('--watch')

function openInBrowser(file) {
  const [cmd, argv] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${file}"`]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]]
  try { spawn(cmd, argv, { detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsVerbatimArguments: true }).unref() } catch {}
}

async function run(first) {
  const t0 = Date.now()
  let last = 0
  const scan = await scanAll({
    home,
    cacheFile: path.join(dir, 'cache.json'),
    onProgress: (done, total) => {
      if (!first || Date.now() - last < 250) return
      last = Date.now()
      process.stderr.write(`\rReading transcripts… ${done}/${total}`)
    },
  })
  if (first) process.stderr.write(`\r${scan.fileCount.toLocaleString('en-US')} transcripts (${(scan.bytes / 1e9).toFixed(1)} GB), ${scan.parsedNow.toLocaleString('en-US')} read now, in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`)
  const plan = savedPlan(home)
  if (!flag('--offline')) { const live = await livePlan(home); if (live) plan.push(live) }
  const report = evaluate(scan.summaries, { plan })
  report.source = { transcripts: scan.fileCount, bytes: scan.bytes }
  if (flag('--json')) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const tmp = outFile + '.tmp'
  fs.writeFileSync(tmp, renderPage(report, { refreshSec: watch ? 60 : 0 }))
  fs.renameSync(tmp, outFile)
  if (first) {
    process.stderr.write(`Report: ${outFile}\n`)
    if (!flag('--no-open')) openInBrowser(outFile)
  }
}

await run(true)
if (watch) {
  process.stderr.write('Watching: rescanning every minute. Ctrl+C stops.\n')
  setInterval(() => run(false).catch((e) => process.stderr.write(String(e) + '\n')), 60000)
}
