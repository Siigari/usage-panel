// evaluate.js: turns the parsed transcripts into the report: totals, breakdowns, and findings with a dollar figure.
// Everything is priced at API list prices, so the dollars compare habits; they aren't a bill on a subscription.

import path from 'node:path'
import { priceOf } from '../hooks/stats.js'

const H = 3600, DAY = 86400
const RECENT_DAYS = 30
const COLD_MIN = 20000          // a cache write this big after an expired cache counts as a cold restart
const BIG_CTX = 200000
const CTX_EDGES = [50000, 200000, 500000]
const CTX_NAMES = ['under 50K', '50K–200K', '200K–500K', 'over 500K']

const pad = (n) => String(n).padStart(2, '0')
const dayOf = (sec) => { const d = new Date(sec * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

// One request's dollars by kind. Fast mode is priced at twice the standard rates.
export function priceRow(r) {
  const p = priceOf(r[2]), k = r[10] ? 2 : 1
  const reads = (r[4] * p.cr * k) / 1e6
  const writes = ((r[5] * p.cw5 + r[6] * p.cw) * k) / 1e6
  const input = (r[3] * p.in * k) / 1e6
  const output = (r[7] * p.out * k) / 1e6
  const web = r[9] * 0.01
  return { reads, writes, input, output, web, total: reads + writes + input + output + web, p, k }
}

const ctxOf = (r) => r[3] + r[4] + r[5] + r[6]
const kinds = () => ({ reads: 0, writes: 0, input: 0, output: 0, web: 0, total: 0, n: 0 })
const addKinds = (a, c) => { a.reads += c.reads; a.writes += c.writes; a.input += c.input; a.output += c.output; a.web += c.web; a.total += c.total; a.n++ }

function projectName(cwd) {
  if (!cwd) return '(unknown)'
  const base = path.win32.basename(path.posix.basename(cwd))
  return base || cwd
}

const appName = (e) => ({ 'claude-vscode': 'VS Code', cli: 'Terminal', 'claude-desktop': 'Desktop', 'sdk-ts': 'Agent SDK', 'sdk-py': 'Agent SDK', 'sdk-cli': 'claude -p' }[e] || e || 'other')

export function evaluate(summaries, { now = Math.floor(Date.now() / 1000), plan = [] } = {}) {
  // Oldest files first, so a reply copied into a resumed session counts where it first happened
  const files = summaries.filter((s) => s && s.reqs.length).sort((a, b) => a.first - b.first)
  const seen = new Set()

  const all = kinds(), recent = kinds()
  const tokens = { input: 0, read: 0, write: 0, output: 0, thinking: 0 }
  const daily = {}, heat = Array.from({ length: 7 }, () => Array(24).fill(0))
  const projects = {}, models = {}, apps = {}, sessions = {}, tools = {}
  const agents = { main: 0, sub: 0 }, recentAgents = { main: 0, sub: 0 }
  const ctx = CTX_NAMES.map((name) => ({ name, n: 0, usd: 0 })), recentCtx = CTX_NAMES.map((name) => ({ name, n: 0, usd: 0 }))
  const cold = { n: 0, usd: 0, recentN: 0, recentUsd: 0 }
  let fastUsd = 0, webN = 0, recentRead = 0, recentPrompt = 0, first = Infinity, last = 0
  const recentFrom = now - RECENT_DAYS * DAY
  // The plan week, for pricing its pace: what this week and the last 3 hours cost at list prices
  const lastPlan = plan.length ? plan[plan.length - 1] : null
  const weekStart = lastPlan && lastPlan[4] ? lastPlan[4] - 7 * DAY : Infinity
  let weekUsd = 0, last3hUsd = 0

  for (const f of files) {
    const proj = projectName(f.cwd)
    const s = sessions[f.session] || (sessions[f.session] = { id: f.session, title: '', project: proj, app: appName(f.entry), start: Infinity, end: 0, n: 0, usd: 0, subUsd: 0, maxCtx: 0, compactions: 0, cold: 0 })
    if (!f.isAgent) { s.title = f.customTitle || f.title || s.title; s.project = proj; s.app = appName(f.entry) }
    s.compactions += f.compactions.length
    for (const [name, n] of Object.entries(f.tools)) tools[name] = (tools[name] || 0) + n

    // The cache lives an hour when this transcript wrote 1-hour entries, otherwise five minutes
    const ttl = f.reqs.some((r) => r[6] > 0) ? H : 300
    let prevT = 0
    for (const r of f.reqs) {
      if (seen.has(r[1])) continue
      seen.add(r[1])
      const c = priceRow(r), t = r[0], isRecent = t >= recentFrom
      addKinds(all, c)
      if (isRecent) addKinds(recent, c)
      first = Math.min(first, t); last = Math.max(last, t)
      tokens.input += r[3]; tokens.read += r[4]; tokens.write += r[5] + r[6]; tokens.output += r[7]; tokens.thinking += r[8]
      if (r[10]) fastUsd += c.total
      if (t >= weekStart) weekUsd += c.total
      if (t >= now - 3 * H) last3hUsd += c.total
      webN += r[9]

      const d = daily[dayOf(t)] || (daily[dayOf(t)] = kinds())
      addKinds(d, c)
      const dt = new Date(t * 1000)
      heat[dt.getDay()][dt.getHours()] += c.total

      const pr = projects[proj] || (projects[proj] = { name: proj, usd: 0, n: 0, sessions: new Set(), recent: 0 })
      pr.usd += c.total; pr.n++; pr.sessions.add(f.session); if (isRecent) pr.recent += c.total
      const m = models[r[2]] || (models[r[2]] = { name: r[2], usd: 0, n: 0, recent: 0 })
      m.usd += c.total; m.n++; if (isRecent) m.recent += c.total
      const a = appName(f.entry)
      apps[a] = (apps[a] || 0) + c.total
      agents[f.isAgent ? 'sub' : 'main'] += c.total
      if (isRecent) recentAgents[f.isAgent ? 'sub' : 'main'] += c.total

      const size = ctxOf(r), b = CTX_EDGES.findIndex((e) => size < e), bi = b < 0 ? 3 : b
      ctx[bi].n++; ctx[bi].usd += c.total
      if (isRecent) {
        recentCtx[bi].n++; recentCtx[bi].usd += c.total
        recentRead += r[4]; recentPrompt += r[3] + r[4] + r[5] + r[6]
      }

      // A cold restart: the session sat longer than the cache lives, so its context was written again instead of read
      const written = r[5] + r[6]
      if (prevT && t - prevT > ttl && written >= COLD_MIN && r[4] < written) {
        const waste = (written * ((r[6] ? c.p.cw : c.p.cw5) - c.p.cr) * c.k) / 1e6
        cold.n++; cold.usd += waste; s.cold += waste
        if (isRecent) { cold.recentN++; cold.recentUsd += waste }
      }
      prevT = t

      s.n++; s.usd += c.total; if (f.isAgent) s.subUsd += c.total
      s.start = Math.min(s.start, t); s.end = Math.max(s.end, t)
      if (!f.isAgent) s.maxCtx = Math.max(s.maxCtx, size)
    }
  }

  const sessionList = Object.values(sessions).filter((s) => s.n).sort((a, b) => b.usd - a.usd)
  const report = {
    generatedAt: now,
    range: { first: isFinite(first) ? first : 0, last },
    totals: { ...all, tokens, sessions: sessionList.length, projects: Object.keys(projects).length, webSearches: webN, fastUsd },
    recent: { days: RECENT_DAYS, ...recent, cacheHit: recentPrompt ? recentRead / recentPrompt : null },
    daily: Object.entries(daily).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, k]) => ({ day, ...k })),
    heat,
    projects: Object.values(projects).map((p) => ({ name: p.name, usd: p.usd, n: p.n, sessions: p.sessions.size, recent: p.recent })).sort((a, b) => b.usd - a.usd),
    models: Object.values(models).sort((a, b) => b.usd - a.usd),
    apps: Object.entries(apps).map(([name, usd]) => ({ name, usd })).sort((a, b) => b.usd - a.usd),
    agents,
    ctx,
    cold,
    sessions: sessionList.slice(0, 40).map((s) => ({ ...s, start: isFinite(s.start) ? s.start : 0 })),
    sessionCount: sessionList.length,
    tools: Object.entries(tools).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 25),
    compactions: sessionList.reduce((s, x) => s + x.compactions, 0),
    plan,
    week: weekPace(plan, now, weekUsd, last3hUsd),
  }
  report.findings = findings(report, { recentCtx, recentAgents })
  report.grades = grades(report, { recentCtx, recentAgents })
  return report
}

// The week's two paces, in points per second. The 3-hour pace is measured from plan readings when they span at
// least 45 of the last 180 minutes; otherwise it is estimated from spend: the points used per list-price dollar so
// far this week, times what the last 3 hours cost.
function weekPace(plan, now, weekUsd, last3hUsd) {
  const last = plan.length ? plan[plan.length - 1] : null
  if (!last || last[2] == null || !last[4]) return null
  const u7 = last[2], r7 = last[4], start = r7 - 7 * DAY
  const week = u7 / Math.max(900, now - start)
  const recent = plan.filter((p) => p[4] === r7 && p[2] != null && p[0] > now - 3 * H)
  let three = null, estimated = false
  if (recent.length > 1 && recent[recent.length - 1][0] - recent[0][0] >= 2700) {
    const a = recent[0], b = recent[recent.length - 1]
    three = (b[2] - a[2]) / (b[0] - a[0])
  } else if (weekUsd > 0 && u7 > 0) {
    three = ((u7 / weekUsd) * last3hUsd) / (3 * H)
    estimated = true
  }
  return { u7, r7, start, at: last[0], week, three, estimated, weekUsd, last3hUsd }
}

const money = (d) => '$' + (d >= 100 ? Math.round(d).toLocaleString('en-US') : d.toFixed(2))
const pct = (f) => Math.round(f * 100) + '%'

// What stands out in the last 30 days, most expensive first
function findings(r, { recentCtx, recentAgents }) {
  const out = []
  const spend = r.recent.total
  if (!spend) return [{ level: 'info', title: 'No requests in the last 30 days', detail: 'The report still covers everything older.', usd: 0 }]

  if (r.cold.recentUsd > 0) {
    out.push({
      level: r.cold.recentUsd / spend > 0.08 ? 'warn' : 'info',
      title: `Cold restarts cost ${money(r.cold.recentUsd)} (${pct(r.cold.recentUsd / spend)} of spend)`,
      detail: `${r.cold.recentN.toLocaleString('en-US')} times a session picked up again after its prompt cache had expired, so its whole context was written to the cache again instead of read from it. A write costs 12–20× a read. Before a long break, finish the thought or run /compact so the next message rewrites less; for a new task, /clear.`,
      usd: r.cold.recentUsd,
    })
  }

  const big = recentCtx[2].usd + recentCtx[3].usd
  if (big > 0) {
    const bigN = recentCtx[2].n + recentCtx[3].n, smallN = recentCtx[0].n + recentCtx[1].n
    const perBig = big / Math.max(1, bigN), perSmall = (recentCtx[0].usd + recentCtx[1].usd) / Math.max(1, smallN)
    out.push({
      level: big / spend > 0.5 ? 'warn' : 'info',
      title: `${pct(big / spend)} of spend carried over 200K tokens of context`,
      detail: `${bigN.toLocaleString('en-US')} requests ran with more than 200K tokens in context, averaging ${money(perBig)} each against ${money(perSmall)} for smaller ones. Every message rereads the whole conversation, so long sessions get dearer per message. /clear between unrelated tasks and /compact once a task's history stops mattering.`,
      usd: big - bigN * perSmall,
    })
  }

  const sub = recentAgents.sub
  if (sub > 0) {
    out.push({
      level: sub / spend > 0.35 ? 'warn' : 'info',
      title: `Subagents spent ${money(sub)} (${pct(sub / spend)})`,
      detail: 'Subagents each start their own context and read their own files. They keep the main conversation small, which is worth it for wide searches; for a single file or a quick lookup, asking directly is cheaper.',
      usd: sub,
    })
  }

  const hit = r.recent.cacheHit
  if (hit != null) {
    out.push({
      level: hit >= 0.9 ? 'good' : hit >= 0.75 ? 'info' : 'warn',
      title: `Cache hit ${pct(hit)}`,
      detail: hit >= 0.9
        ? 'Almost every prompt token came from the cache, which is as cheap as Claude Code gets.'
        : 'A good share of prompt tokens were written fresh rather than read from the cache. Cold restarts, edits to CLAUDE.md or tools mid-session, and switching models all start the cache over.',
      usd: 0,
    })
  }

  const top = [...r.models].sort((a, b) => b.recent - a.recent)[0]
  if (top && top.recent > 0) {
    out.push({
      level: 'info',
      title: `${top.name} is ${pct(top.recent / spend)} of spend`,
      detail: 'The model you run most. For routine edits and lookups a smaller model or lower effort can cost a fraction; /model switches it.',
      usd: 0,
    })
  }

  if (r.totals.tokens.output && r.totals.tokens.thinking) {
    const share = r.totals.tokens.thinking / r.totals.tokens.output
    out.push({ level: 'info', title: `${pct(share)} of output tokens were thinking`, detail: 'Thinking is billed as output. Effort (/effort or the model picker) sets how much the model thinks before it answers.', usd: 0 })
  }

  if (r.totals.fastUsd > 0) {
    out.push({ level: 'info', title: `Fast mode: ${money(r.totals.fastUsd)}`, detail: 'Fast mode runs the same model quicker at twice the price; /fast turns it off.', usd: r.totals.fastUsd })
  }

  const order = { warn: 0, info: 1, good: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level] || b.usd - a.usd)
}

// Four letter grades for the last 30 days
function grades(r, { recentCtx, recentAgents }) {
  const spend = r.recent.total || 1
  const g = (v, a, b, c, lowerIsBetter = true) => {
    if (v == null) return '–'
    const x = lowerIsBetter ? v : -v
    const [A, B, C] = lowerIsBetter ? [a, b, c] : [-a, -b, -c]
    return x <= A ? 'A' : x <= B ? 'B' : x <= C ? 'C' : 'D'
  }
  const coldShare = r.cold.recentUsd / spend
  const bigShare = (recentCtx[2].usd + recentCtx[3].usd) / spend
  const subShare = recentAgents.sub / spend
  return [
    { name: 'Cache hit', value: r.recent.cacheHit == null ? '–' : pct(r.recent.cacheHit), grade: g(r.recent.cacheHit, 0.92, 0.85, 0.75, false), note: 'prompt tokens read from cache' },
    { name: 'Cold restarts', value: pct(coldShare), grade: g(coldShare, 0.03, 0.08, 0.15), note: 'of spend rewriting expired caches' },
    { name: 'Big context', value: pct(bigShare), grade: g(bigShare, 0.25, 0.5, 0.75), note: 'of spend over 200K context' },
    { name: 'Subagents', value: pct(subShare), grade: g(subShare, 0.2, 0.35, 0.5), note: 'of spend in subagents' },
  ]
}
