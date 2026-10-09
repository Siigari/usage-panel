// demo.js: a made-up history for screenshots and for trying the report without any transcripts (--demo).
// Same shapes the parser produces, so the demo runs through the real evaluation and page.

const H = 3600, DAY = 86400

function rng(seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

const PROJECTS = ['web-app', 'api-server', 'mobile', 'data-pipeline', 'docs-site', 'infra', 'cli-tool']
const TITLES = [
  'Fix login redirect loop', 'Add pagination to orders API', 'Migrate auth to OAuth', 'Speed up CI test suite',
  'Refactor billing webhooks', 'Dark mode for settings', 'Investigate flaky upload test', 'Write onboarding docs',
  'Terraform module for queues', 'Add CSV export', 'Upgrade to React 20', 'Rate limiter for public API',
  'Nightly ETL backfill job', 'Fix memory leak in worker', 'Search with typo tolerance', 'Push notifications on iOS',
]
const MODELS = [['claude-opus-5-5', 0.72], ['claude-sonnet-5', 0.2], ['claude-haiku-4-5', 0.08]]
const ENTRIES = [['cli', 0.55], ['claude-vscode', 0.35], ['claude-desktop', 0.1]]
const TOOLS = ['Bash', 'Read', 'Edit', 'Grep', 'Write', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Agent']

function pickWeighted(r, list) {
  let x = r()
  for (const [v, w] of list) { if ((x -= w) <= 0) return v }
  return list[0][0]
}

export function demoSummaries(now = Math.floor(Date.now() / 1000)) {
  const r = rng(42)
  const out = []
  let id = 0
  const start = now - 75 * DAY
  for (let day = start; day < now; day += DAY) {
    const d = new Date(day * 1000)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    const sessionsToday = weekend ? Math.floor(r() * 2) : 2 + Math.floor(r() * 4)
    for (let k = 0; k < sessionsToday; k++) {
      const dayStart = new Date(day * 1000); dayStart.setHours(0, 0, 0, 0)
      let t = dayStart.getTime() / 1000 + (8.5 + r() * 10) * H
      if (t > now - 300) continue
      const model = pickWeighted(r, MODELS)
      const session = 'demo' + String(out.length).padStart(4, '0') + '-0000-4000-8000-000000000000'
      const s = {
        session, isAgent: false, cwd: '/home/dev/' + PROJECTS[Math.floor(r() * PROJECTS.length)],
        title: TITLES[Math.floor(r() * TITLES.length)], customTitle: '', entry: pickWeighted(r, ENTRIES), version: '2.1.295', branch: 'main',
        reqs: [], compactions: [], tools: {}, first: 0, last: 0,
      }
      const n = 30 + Math.floor(r() * r() * 900)
      let ctx = 18000 + Math.floor(r() * 12000)
      for (let i = 0; i < n && t < now; i++) {
        const grow = 600 + Math.floor(r() * 4200)
        const idle = r() < 0.003 ? H + r() * 2 * H : 6 + r() * 70
        t += idle
        if (t > now) break
        const cold = idle > H
        const out_ = 150 + Math.floor(r() * 2400)
        const row = [Math.floor(t), 'demo' + (id++), model, 2 + Math.floor(r() * 40), cold ? 0 : ctx, 0, cold ? ctx + grow : grow, out_, Math.floor(out_ * (0.1 + r() * 0.25)), r() < 0.01 ? 1 : 0, 0]
        s.reqs.push(row)
        ctx += grow
        if (ctx > 380000) { s.compactions.push([Math.floor(t), ctx, 0]); ctx = 30000 + Math.floor(r() * 20000) }
        const tool = TOOLS[Math.floor(r() * r() * TOOLS.length)]
        s.tools[tool] = (s.tools[tool] || 0) + 1
      }
      if (!s.reqs.length) continue
      s.first = s.reqs[0][0]; s.last = s.reqs[s.reqs.length - 1][0]
      out.push(s)
      // Some sessions send a subagent or two
      if (r() < 0.6) {
        const a = { ...s, isAgent: true, reqs: [], compactions: [], tools: { Read: 8, Grep: 6, Glob: 3 } }
        let at = s.first + (s.last - s.first) * r(), actx = 15000
        for (let i = 0; i < 40 + Math.floor(r() * 80); i++) {
          at += 5 + r() * 20
          const g = 2000 + Math.floor(r() * 6000)
          a.reqs.push([Math.floor(at), 'demo' + (id++), 'claude-sonnet-5', 3, actx, 0, g, 300 + Math.floor(r() * 800), 50, 0, 0])
          actx += g
        }
        a.first = a.reqs[0][0]; a.last = a.reqs[a.reqs.length - 1][0]
        out.push(a)
      }
    }
  }
  // One session running right now, so the live strip has something to show
  const live = { session: 'demo-live-0000-4000-8000-000000000000', isAgent: false, cwd: '/home/dev/web-app', title: 'Checkout flow redesign', customTitle: '', entry: 'cli', version: '2.1.295', branch: 'main', reqs: [], compactions: [], tools: { Edit: 40, Read: 55, Bash: 30 }, first: 0, last: 0 }
  let t = now - 2.5 * H, ctx = 40000
  while (t < now - 20) {
    t += 15 + r() * 40
    const g = 800 + Math.floor(r() * 3000)
    live.reqs.push([Math.floor(t), 'demo' + (id++), 'claude-opus-5-5', 4, ctx, 0, g, 200 + Math.floor(r() * 1800), 120, 0, 0])
    ctx += g
  }
  live.first = live.reqs[0][0]; live.last = live.reqs[live.reqs.length - 1][0]
  out.push(live)
  return out
}

// Plan readings for the demo week: the weekly percent follows the demo's own spend this week
export function demoPlan(summaries, priceRow, now = Math.floor(Date.now() / 1000)) {
  const r7 = now + Math.floor(4.4 * DAY), start = r7 - 7 * DAY
  const reqs = summaries.flatMap((s) => s.reqs).filter((q) => q[0] >= start).sort((a, b) => a[0] - b[0])
  const total = reqs.reduce((a, q) => a + priceRow(q).total, 0) || 1
  const ratio = 41 / total
  const rows = []
  let i = 0, cum = 0
  for (let t = start + 1800; t <= now; t += 900) {
    while (i < reqs.length && reqs[i][0] <= t) cum += priceRow(reqs[i++]).total
    const five = reqs.filter((q) => q[0] > t - 5 * H && q[0] <= t).reduce((a, q) => a + priceRow(q).total, 0)
    const r5 = Math.ceil(t / (5 * H)) * 5 * H
    rows.push([t, Math.min(100, Math.round(five * ratio * 9)), Math.round(cum * ratio * 10) / 10, r5, r7])
  }
  return rows
}
