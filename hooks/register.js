// usage-panel: records what each model request costs and the plan's 5-hour and weekly percent, and draws them in a
// pane that /meter opens and closes.
//
// Storage ($.store, shared by every session on this machine):
//   req:<day>:<session>  this session's requests that day, written by this session only, so sessions never race
//   plan:<day>           plan readings that day; account-wide, so every session adds to the same list
// Request rows keep 2 days, plan rows 8 (the week chart needs the whole week).

import { summarize } from './stats.js'
import { drawPanel } from './draw.js'

const PANE = 'usage-panel'
const KEEP_REQ_DAYS = 2
const KEEP_PLAN_DAYS = 8
const REFRESH_MS = 20000

let mine = { day: '', req: [] }   // this session's rows for today, as saved under its own key
let all = { req: [], plan: [] }   // every session's rows, read from the store when the pane opens and on a timer
let isOpen = false

const nowSec = () => Math.floor(Date.now() / 1000)
const pad = (n) => String(n).padStart(2, '0')
const dayOf = (sec) => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const daysAgo = (day) => (Date.parse(dayOf(nowSec()) + 'T00:00:00') - Date.parse(day + 'T00:00:00')) / 864e5
const byTime = (a, b) => a[0] - b[0]

async function sessionTag($) {
  return String(await $.session.id()).slice(0, 8)
}

// Reads every saved row; drops days older than we keep
async function refresh($, prune) {
  const keys = await $.store.keys()
  const req = [], plan = []
  for (const key of keys) {
    const [kind, day] = key.split(':')
    if (kind !== 'req' && kind !== 'plan') continue
    const age = daysAgo(day)
    if (age >= (kind === 'req' ? KEEP_REQ_DAYS : KEEP_PLAN_DAYS)) {
      if (prune) await $.store.delete(key)
      continue
    }
    const rows = await $.store.get(key)
    if (Array.isArray(rows)) (kind === 'req' ? req : plan).push(...rows)
  }
  all = { req: req.sort(byTime), plan: plan.sort(byTime) }
}

async function recordRequest($, usage) {
  const t = nowSec(), day = dayOf(t), tag = await sessionTag($)
  if (mine.day !== day || mine.tag !== tag) mine = { day, tag, req: (await $.store.get(`req:${day}:${tag}`)) || [] }
  const row = [t, usage.model || '', usage.input_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation_input_tokens || 0, usage.output_tokens || 0, tag]
  mine.req.push(row)
  all.req.push(row)
  await $.store.set(`req:${day}:${tag}`, mine.req)
  if (isOpen) $.ui.invalidate('ui.render')
}

function planRow(rateLimits, t) {
  const five = rateLimits.find((r) => r.kind === 'five_hour')
  const week = rateLimits.find((r) => r.kind === 'seven_day')
  if (!five && !week) return null
  const sec = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0)
  return [t, five ? five.percentUsed : null, week ? week.percentUsed : null, sec(five && five.resetsAt), sec(week && week.resetsAt)]
}

function withLive(plan, rateLimits, now) {
  const row = planRow(rateLimits, now)
  return row ? [...plan, row] : plan
}

async function recordPlan($, rateLimits) {
  const t = nowSec()
  const row = planRow(rateLimits, t)
  if (!row) return
  const last = all.plan[all.plan.length - 1]
  const same = last && last[1] === row[1] && last[2] === row[2] && last[4] === row[4]
  if (same && t - last[0] < 600) return
  // Read again right before writing: other sessions add to the same day's list
  const key = `plan:${dayOf(t)}`
  const saved = (await $.store.get(key)) || []
  saved.push(row)
  await $.store.set(key, saved)
  all.plan.push(row)
  if (isOpen) $.ui.invalidate('ui.render')
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'meter', description: 'Open or close the usage panel; /meter web opens the full report', argumentHint: '[web]', immediate: true })
    await refresh($, true)
    $.clock.every(REFRESH_MS, () => {
      if (isOpen) refresh($, false).then(() => $.ui.invalidate('ui.render'))
    })
    return next(e)
  })

  // Every model request, main conversation and subagents alike: let it run, then note what it cost
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result && result.usage) {
      try { await recordRequest($, result.usage) } catch {}
    }
    return result
  })

  // The plan's percent moved, or the context did
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits && e.rateLimits.length) {
      try { await recordPlan($, e.rateLimits) } catch {}
    }
    if (isOpen) $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'meter' }, async ($, e) => {
    if (String(e.args || '').trim() === 'web') {
      $.ui.toast('Reading your Claude Code transcripts…')
      try {
        const r = await $.process.run(['node', $.plugin.root + '/reader/usage-reader.js'], { timeoutMs: 600000 })
        if (r.exitCode === 0) return { text: 'Opened the usage report in your browser. ' + (r.stderr.trim().split('\n').pop() || '') }
        return { text: 'The usage report failed:\n' + (r.stderr || r.stdout).trim().slice(-1500) }
      } catch {
        return { text: 'The usage report needs Node.js 18 or newer (nodejs.org). With Node installed, `npx github:Siigari/usage-panel` runs it too.' }
      }
    }
    const panes = await $.ui.panes()
    if (panes.some((p) => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      isOpen = false
    } else {
      await refresh($, false)
      isOpen = true
      await $.ui.open({ id: PANE, title: 'Usage', closeOnEscape: true })
    }
    return {}
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isOpen = false
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    isOpen = true
    const usage = await $.session.usage()
    const tag = await sessionTag($)
    const now = nowSec()
    // The live reading counts even before session.measure has saved one
    const plan = withLive(all.plan, usage.rateLimits || [], now)
    const data = { now, mine: tag, rows: all.req, plan, context: usage.context }
    data.summary = summarize(all.req, plan, { now, mine: tag, context: usage.context })
    return drawPanel($.ui.resolve(e), e.surface, e.props.bodyColumns, data)
  })
}
