#!/usr/bin/env node
// usage-reader: reads every Claude Code transcript on this computer, evaluates the usage, and opens a report.
//
//   usage-reader              scan, write the report, open it in the browser
//   usage-reader --watch      keep rescanning every minute; the open page reloads itself
//   usage-reader --no-open    write the report without opening it
//   usage-reader --plan       also read the plan's live percent from Anthropic, with this machine's Claude Code login
//                             (off by default: without it, nothing leaves the machine)
//   usage-reader --share      also write report-share.html and .md: numbers and tool names only, safe to send
//   usage-reader --compare ISO [--project NAME]   before and after a moment, for one project folder or all
//   usage-reader --out FILE   write the report somewhere else
//   usage-reader --json       print the report data instead of writing a page
//   usage-reader --demo       a made-up history instead of this computer's, to see what the report looks like

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { scanAll, claudeHome } from './scan.js'
import { evaluate, priceRow } from './evaluate.js'
import { demoSummaries, demoPlan } from './demo.js'
import { savedPlan, livePlan, rememberPlan } from './plan.js'
import { renderPage } from './page.js'
import { anonymize, shareMarkdown, selfCheck } from './share.js'
import { compare } from './savings.js'

const args = process.argv.slice(2)
const flag = (f) => args.includes(f)
const home = claudeHome()
const dir = path.join(home, 'usage-reader')
const demo = args.includes('--demo')
const outFile = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(dir, demo ? 'demo.html' : 'report.html')
const watch = flag('--watch')
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null)
const livePlanOn = flag('--plan') && !flag('--offline')

function openInBrowser(file) {
  const [cmd, argv] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${file}"`]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]]
  try { spawn(cmd, argv, { detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsVerbatimArguments: true }).unref() } catch {}
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

// Both sources by time, without repeats
function mergePlan(a, b) {
  const seen = new Set()
  return [...a, ...b].sort((x, y) => x[0] - y[0]).filter((r) => { const k = r.join(','); if (seen.has(k)) return false; seen.add(k); return true })
}

async function runDemo() {
  const summaries = demoSummaries()
  const report = evaluate(summaries, { plan: demoPlan(summaries, priceRow) })
  if (flag('--json')) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, renderPage(report))
  process.stderr.write(`Demo report: ${outFile}\n`)
  if (!flag('--no-open')) openInBrowser(outFile)
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
  let plan = savedPlan(home)
  if (livePlanOn) {
    const live = await livePlan(home)
    if (live) plan = mergePlan(plan, rememberPlan(path.join(dir, 'plan.json'), live))
  } else {
    plan = mergePlan(plan, readJson(path.join(dir, 'plan.json')) || [])
  }
  const report = evaluate(scan.summaries, { plan })
  report.source = { transcripts: scan.fileCount, bytes: scan.bytes }
  if (opt('--compare')) {
    const at = Math.floor(Date.parse(opt('--compare')) / 1000)
    if (!at) { process.stderr.write('--compare needs a time, like 2026-10-23T12:00\n'); process.exit(2) }
    printCompare(compare(report.kept, at, { project: opt('--project') || undefined }))
    return
  }
  if (flag('--json')) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  const tmp = outFile + '.tmp'
  fs.writeFileSync(tmp, renderPage(report, { refreshSec: watch ? 60 : 0 }))
  fs.renameSync(tmp, outFile)
  if (flag('--share')) writeShare(report, first)
  if (first) {
    process.stderr.write(`Report: ${outFile}\n`)
    if (!flag('--no-open')) openInBrowser(outFile)
  }
}

// The safe-to-send copy: written only if the self-check finds nothing that identifies anyone
function writeShare(report, loud) {
  const { report: R, secrets, titles } = anonymize(report)
  const html = renderPage(R), md = shareMarkdown(R)
  const found = selfCheck(R, [md], { secrets, titles })
  const base = path.join(path.dirname(outFile), 'report-share')
  if (found.length) {
    for (const f of [base + '.html', base + '.md']) try { fs.unlinkSync(f) } catch {}
    process.stderr.write(`Share copy NOT written: the check found ${found.length} thing(s) that could identify you (${found.slice(0, 3).map((x) => JSON.stringify(x.slice(0, 40))).join(', ')}). Please report this as a bug.\n`)
    return
  }
  fs.writeFileSync(base + '.html', html); fs.writeFileSync(base + '.md', md)
  if (loud) process.stderr.write(`Share copy: ${base}.html and .md\nThis file is safe to send: numbers, model names and tool names only (checked).\n`)
}

function printCompare(c) {
  const $ = (d) => '$' + d.toFixed(2), p = (f) => Math.round(f * 100) + '%', k = (n) => Math.round(n / 1000) + 'K'
  const rows = [
    ['requests', (s) => s.requests.toLocaleString('en-US')], ['active hours', (s) => String(s.activeHours)],
    ['requests / active hour', (s) => s.reqPerHour.toFixed(0)], ['$ / active hour', (s) => $(s.usdPerHour)],
    ['average reread / request', (s) => k(s.avgReread)], ['tool-result round trips', (s) => p(s.tripShare)],
    ['"done" requests', (s) => p(s.doneShare)], ['spend over 300K', (s) => p(s.over300)],
  ]
  const out = [`Before and after ${new Date(c.at * 1000).toLocaleString()}${c.project ? ` in ${c.project}` : ', all projects'} (list prices; an active hour has at least one request)`, '']
  out.push(''.padEnd(28) + 'before'.padStart(12) + 'after'.padStart(12))
  for (const [name, f] of rows) out.push(name.padEnd(28) + f(c.before).padStart(12) + f(c.after).padStart(12))
  process.stdout.write(out.join('\n') + '\n')
}

if (demo) await runDemo()
else await run(true)
if (watch && !demo) {
  process.stderr.write('Watching: rescanning every minute. Ctrl+C stops.\n')
  setInterval(() => run(false).catch((e) => process.stderr.write(String(e) + '\n')), 60000)
}
