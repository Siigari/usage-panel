// page.js: the report as one self-contained HTML file. The data rides in a <script> tag and `client` draws it,
// so the page opens from disk with no server and no network.

export function renderPage(report, { refreshSec = 0 } = {}) {
  const data = JSON.stringify(report).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshSec ? `<meta http-equiv="refresh" content="${refreshSec}">` : ''}
<title>Claude Usage</title>
<style>${CSS}</style>
</head>
<body>
<main id="app"></main>
<div id="tip" hidden></div>
<script>window.REPORT = ${data};</script>
<script>(${client.toString()})(window.REPORT);</script>
</body>
</html>`
}

const CSS = `
:root {
  --bg: #0d1117; --panel: #161b22; --line: #30363d; --text: #e6edf3; --muted: #8b949e; --dim: #6e7681;
  --blue: #58a6ff; --orange: #f0883e; --purple: #a371f7; --green: #3fb950; --amber: #d29922; --red: #f85149;
  --mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1280px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 20px; margin: 0; letter-spacing: .02em; }
h2 { font: 600 12px/1 var(--mono); color: var(--blue); letter-spacing: .08em; margin: 0 0 12px; text-transform: uppercase; }
h2 small { color: var(--dim); font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 8px; }
.sub { color: var(--muted); margin-top: 4px; }
.grid { display: grid; gap: 12px; }
.tiles { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin: 20px 0; }
.two { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 12px; min-width: 0; }
.tile .k { color: var(--muted); font-size: 12px; }
.tile .v { font: 600 24px/1.2 var(--mono); margin-top: 4px; }
.tile .n { color: var(--dim); font-size: 12px; margin-top: 2px; }
.meter { height: 6px; background: var(--line); border-radius: 3px; margin-top: 8px; overflow: hidden; }
.meter i { display: block; height: 100%; background: var(--green); }
.grades { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-bottom: 16px; }
.grade { display: flex; gap: 12px; align-items: center; }
.grade b { font: 700 28px/1 var(--mono); width: 40px; height: 40px; display: grid; place-items: center; border-radius: 8px; border: 1px solid var(--line); }
.grade .gA { color: var(--green); } .grade .gB { color: var(--blue); } .grade .gC { color: var(--amber); } .grade .gD { color: var(--red); }
.grade div div:first-child { font-weight: 600; }
.grade small { color: var(--muted); }
.finding { display: grid; grid-template-columns: 10px 1fr auto; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
.finding:first-child { border-top: 0; }
.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
.dot.warn { background: var(--amber); } .dot.info { background: var(--blue); } .dot.good { background: var(--green); }
.finding .t { font-weight: 600; }
.finding .d { color: var(--muted); margin-top: 2px; }
.finding .u { font-family: var(--mono); color: var(--muted); white-space: nowrap; }
canvas { display: block; width: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
.toggle { float: right; display: flex; gap: 4px; }
.toggle button { background: transparent; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 2px 10px; font: 12px var(--mono); cursor: pointer; }
.toggle button[aria-pressed="true"] { color: var(--text); border-color: var(--blue); }
.bars { display: grid; grid-template-columns: minmax(80px, 34%) 1fr auto; gap: 6px 10px; align-items: center; font-size: 13px; }
.bar { display: contents; }
.bar .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar .track { height: 10px; background: var(--line); border-radius: 3px; overflow: hidden; }
.bar .track i { display: block; height: 100%; background: var(--blue); }
.bar .val { font-family: var(--mono); color: var(--muted); white-space: nowrap; text-align: right; min-width: 70px; }
.heat { display: grid; grid-template-columns: 34px repeat(24, 1fr); gap: 2px; font: 11px var(--mono); color: var(--dim); }
.heat span { aspect-ratio: 1.6; border-radius: 2px; background: var(--line); }
.heat em { font-style: normal; text-align: center; }
.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--line); padding: 6px 8px; white-space: nowrap; }
td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
td.num, th.num { text-align: right; font-family: var(--mono); white-space: nowrap; }
td .title { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
td .muted { color: var(--dim); font-size: 12px; }
#tip { position: fixed; pointer-events: none; background: #1f2630; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: 12px/1.5 var(--mono); color: var(--text); z-index: 10; white-space: pre; }
.note { color: var(--dim); font-size: 12px; margin-top: 8px; }
.strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px 28px; font: 13px/1.6 var(--mono); padding: 14px 16px; margin-top: 16px; }
.strip h3 { font: 600 12px/1 var(--mono); color: var(--blue); letter-spacing: .06em; margin: 0 0 6px; }
.strip h3 small { color: var(--dim); font-weight: 400; letter-spacing: 0; margin-left: 6px; }
.strip .row { display: flex; justify-content: space-between; gap: 12px; }
.strip .row span:first-child { color: var(--muted); }
.strip .row span:last-child { white-space: nowrap; }
.strip .meter { margin: 2px 0 4px; height: 4px; }
`

// Runs in the browser. It must stay self-contained: it is copied into the page as source text.
function client(R) {
  const C = { reads: '#58a6ff', writes: '#f0883e', input: '#a371f7', output: '#3fb950', web: '#8b949e', line: '#30363d', dim: '#6e7681', muted: '#8b949e', text: '#e6edf3', amber: '#d29922', red: '#f85149', white: '#ffffff' }
  const KINDS = ['reads', 'writes', 'input', 'output']
  const app = document.getElementById('app'), tip = document.getElementById('tip')
  // Each top-level block carries its name, so #only=strip,week shows just those
  const add = (name, node) => { node.dataset.s = name; app.append(node) }
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else n.setAttribute(k, v) }
    for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : String(k))
    return n
  }
  const money = (d) => '$' + (d >= 1000 ? Math.round(d).toLocaleString() : d >= 100 ? d.toFixed(0) : d.toFixed(2))
  const pct = (f) => Math.round(f * 100) + '%'
  const num = (n) => Math.round(n).toLocaleString()
  const tok = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n)
  const date = (s) => new Date(s * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const dayHour = (s) => new Date(s * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const showTip = (ev, text) => { tip.textContent = text; tip.hidden = false; const w = tip.offsetWidth; tip.style.left = Math.min(ev.clientX + 14, innerWidth - w - 8) + 'px'; tip.style.top = ev.clientY + 14 + 'px' }
  const hideTip = () => { tip.hidden = true }

  function sizeCanvas(cv, h) {
    const dpr = devicePixelRatio || 1, w = cv.parentElement.clientWidth
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px'
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { g, w, h }
  }

  // ---------- header ----------
  const t = R.totals
  add('header', el('header', null,
    el('h1', null, 'Claude Usage'),
    el('div', { class: 'sub' }, `${date(R.range.first)} – ${date(R.range.last)} · ${num(t.n)} requests · ${num(t.sessions)} sessions · ${num(t.projects)} projects · priced at API list rates`),
  ))

  const lastPlan = R.plan.length ? R.plan[R.plan.length - 1] : null

  // ---------- the live strip ----------
  if (R.live) {
    const L = R.live, money2 = (d) => '$' + (d < 1 ? d.toFixed(3) : d.toFixed(2))
    const row = (k, v, color) => el('div', { class: 'row' }, el('span', null, k), el('span', color ? { style: 'color:' + color } : null, v))
    const block = (title, note, rows) => el('div', null, el('h3', null, title, note ? el('small', null, note) : null), rows)
    const share = (v) => (L.mix.total ? Math.round((v / L.mix.total) * 100) + '%' : '–')
    const clock = (s) => new Date(s * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    const dayClock = (s) => new Date(s * 1000).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' })
    const bar = (p) => el('div', { class: 'meter' }, el('i', { style: `width:${Math.min(100, p || 0)}%;background:${p >= 90 ? C.red : p >= 67 ? C.amber : '#3fb950'}` }))
    const ctx = L.forecast.context
    const blocks = [
      block('SPEND', 'list $', [
        row('5m', `${money2(L.spend.m5.usd)} · ${L.spend.m5.n} req`), row('30m', `${money2(L.spend.m30.usd)} · ${L.spend.m30.n} req`),
        row('1h', `${money2(L.spend.h1.usd)} · ${L.spend.h1.n} req`), row('today', `${money2(L.spend.today.usd)} · ${L.spend.today.n} req`)]),
      block('PRESSURE', '', [
        row('now', money2(L.pressure.nowPerHour) + '/h'), row('1h pace', money2(L.pressure.hourPace) + '/h'),
        row('req/h', String(L.pressure.reqPerHour)), row('cache hit', L.pressure.cacheHit == null ? '–' : Math.round(L.pressure.cacheHit * 100) + '%')]),
      block('TODAY\u2019S MIX', '', [
        row('reads', `${money2(L.mix.reads)} · ${share(L.mix.reads)}`), row('writes', `${money2(L.mix.writes)} · ${share(L.mix.writes)}`),
        row('input', `${money2(L.mix.input)} · ${share(L.mix.input)}`), row('output', `${money2(L.mix.output)} · ${share(L.mix.output)}`)]),
      block('FORECAST', '', [
        row('end of day', '~' + money2(L.forecast.endOfDay)), row('next 24h', '~' + money2(L.forecast.next24h)),
        row('context', ctx ? `${tok(ctx.tokens)} / ${tok(ctx.window)}` : '–'),
        row('full in', ctx && ctx.fullIn != null ? '~' + ctx.fullIn.toFixed(1) + ' h' : '–')]),
    ]
    if (lastPlan) {
      const W = R.week, pace = W ? (W.three != null ? W.three : W.week) : null
      const fullAt = W && pace > 0 && W.u7 + pace * (W.r7 - R.generatedAt) >= 100 ? R.generatedAt + (100 - W.u7) / pace : null
      blocks.push(block('PLAN', 'whole account', [
        row('5-hour', `${lastPlan[1] == null ? '–' : Math.round(lastPlan[1]) + '%'}  ↻ ${lastPlan[3] ? clock(lastPlan[3]) : '–'}`), bar(lastPlan[1]),
        row('weekly', `${lastPlan[2] == null ? '–' : Math.round(lastPlan[2]) + '%'}  ↻ ${lastPlan[4] ? dayClock(lastPlan[4]) : '–'}`), bar(lastPlan[2]),
        row('forecast', fullAt ? 'full ' + dayClock(fullAt) : W ? 'lasts to reset' : '–', fullAt ? C.amber : null)]))
    }
    const stripEl = el('section', { class: 'panel strip' }, blocks)
    if (ctx && ctx.title) stripEl.title = 'context: ' + ctx.title
    add('strip', stripEl)
  }
  const tile = (k, v, n, meter) => el('div', { class: 'panel tile' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v), n ? el('div', { class: 'n' }, n) : null,
    meter != null ? el('div', { class: 'meter' }, el('i', { style: `width:${Math.min(100, meter)}%;background:${meter >= 90 ? C.red : meter >= 67 ? C.amber : '#3fb950'}` })) : null)
  const tiles = [
    tile('All time', money(t.total), `${tok(t.tokens.read + t.tokens.write + t.tokens.input + t.tokens.output)} tokens`),
    tile(`Last ${R.recent.days} days`, money(R.recent.total), `${num(R.recent.n)} requests · ${money(R.recent.total / R.recent.days)}/day`),
    tile('Busiest day', (() => { const b = [...R.daily].sort((a, b) => b.total - a.total)[0]; return b ? money(b.total) : '–' })(), (() => { const b = [...R.daily].sort((a, b) => b.total - a.total)[0]; return b ? new Date(b.day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '' })()),
  ]
  add('tiles', el('section', { class: 'grid tiles' }, tiles))

  // ---------- evaluation ----------
  add('evaluation', el('section', { class: 'panel' },
    el('h2', null, 'Evaluation', el('small', null, `last ${R.recent.days} days`)),
    el('div', { class: 'grid grades' }, R.grades.map((g) => el('div', { class: 'grade' },
      el('b', { class: 'g' + g.grade }, g.grade),
      el('div', null, el('div', null, `${g.name} ${g.value}`), el('small', null, g.note))))),
    el('div', null, R.findings.map((f) => el('div', { class: 'finding' },
      el('span', { class: 'dot ' + f.level }),
      el('div', null, el('div', { class: 't' }, f.title), el('div', { class: 'd' }, f.detail)),
      el('div', { class: 'u' }, f.usd > 0.005 ? money(f.usd) : '')))),
  ))

  // ---------- spend over time ----------
  const spendPanel = el('section', { class: 'panel' })
  const toggle = el('div', { class: 'toggle' })
  spendPanel.append(el('h2', null, 'Spend per day', toggle),
    el('div', { class: 'legend' }, KINDS.map((k) => el('span', null, el('i', { style: 'background:' + C[k] }), k))),
    el('div', null, el('canvas', { id: 'daily' })))
  add('daily', spendPanel)
  let range = 30
  for (const [label, days] of [['30d', 30], ['90d', 90], ['All', 0]]) {
    const b = el('button', { 'aria-pressed': String(days === range) }, label)
    b.onclick = () => { range = days; for (const x of toggle.children) x.setAttribute('aria-pressed', String(x === b)); drawDaily() }
    toggle.append(b)
  }
  function dailySeries() {
    // Every calendar day in range, zero-filled, so gaps show as gaps
    const byDay = Object.fromEntries(R.daily.map((d) => [d.day, d]))
    const end = new Date(); end.setHours(12, 0, 0, 0)
    const start = range ? new Date(end.getTime() - (range - 1) * 864e5) : new Date(R.daily.length ? R.daily[0].day + 'T12:00' : end)
    const out = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      out.push(byDay[key] || { day: key, reads: 0, writes: 0, input: 0, output: 0, web: 0, total: 0, n: 0 })
    }
    return out
  }
  function drawDaily() {
    const cv = document.getElementById('daily'), { g, w, h } = sizeCanvas(cv, 220)
    const s = dailySeries(), padL = 52, padB = 22, padT = 10, cw = (w - padL) / s.length, ch = h - padB - padT
    const max = Math.max(1, ...s.map((d) => d.total))
    g.clearRect(0, 0, w, h)
    g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono')
    g.fillStyle = C.dim; g.strokeStyle = C.line; g.textAlign = 'right'
    for (let i = 0; i <= 4; i++) {
      const y = padT + ch * (1 - i / 4)
      g.beginPath(); g.moveTo(padL, y + 0.5); g.lineTo(w, y + 0.5); g.stroke()
      g.fillText(money((max * i) / 4), padL - 6, y + 4)
    }
    s.forEach((d, i) => {
      let y = h - padB
      for (const k of KINDS) {
        const bh = (d[k] / max) * ch
        if (bh > 0) { g.fillStyle = C[k]; g.fillRect(padL + i * cw + 0.5, y - bh, Math.max(1, cw - 1), bh) }
        y -= bh
      }
    })
    g.fillStyle = C.dim; g.textAlign = 'center'
    const every = Math.ceil(s.length / Math.max(1, Math.floor((w - padL) / 70)))
    s.forEach((d, i) => { if (i % every === 0) g.fillText(new Date(d.day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), padL + i * cw + cw / 2, h - 6) })
    cv.onmousemove = (ev) => {
      const i = Math.floor((ev.offsetX - padL) / cw), d = s[i]
      if (!d || ev.offsetX < padL) return hideTip()
      showTip(ev, `${new Date(d.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}\n${money(d.total)} · ${num(d.n)} requests\nreads  ${money(d.reads)}\nwrites ${money(d.writes)}\ninput  ${money(d.input)}\noutput ${money(d.output)}`)
    }
    cv.onmouseleave = hideTip
  }

  // ---------- the plan week ----------
  let drawWeek = null
  if (R.week) {
    const { r7, start, u7 } = R.week, now = R.generatedAt
    const rec = R.plan.filter((p) => p[4] === r7 && p[2] != null).map((p) => [p[0], p[2]])
    const weekPace = R.week.week, recentPace = R.week.three
    const atReset = (p) => u7 + p * (r7 - now)
    const fullAt = (p) => (p > 0 && u7 + p * (r7 - now) >= 100 ? now + (100 - u7) / p : null)
    const notes = [
      [C.text, `now ${Math.round(u7)}% · even pace ${Math.round(((now - start) / (7 * 86400)) * 100)}%`],
      [C.amber, `week pace → ${Math.round(atReset(weekPace))}% at reset${fullAt(weekPace) ? ' (full ' + dayHour(fullAt(weekPace)) + ')' : ''}`],
    ]
    if (recentPace != null) notes.push([C.red, `3h pace${R.week.estimated ? ' (est. from ' + money(R.week.last3hUsd) + ' spent)' : ''} → ${Math.round(atReset(recentPace))}% at reset${fullAt(recentPace) ? ' (full ' + dayHour(fullAt(recentPace)) + ')' : ''}`])
    notes.push([C.dim, 'resets ' + dayHour(r7)])
    add('week', el('section', { class: 'panel' },
      el('h2', null, 'This week', el('small', null, 'grey = even pace · white = recorded · dashed = forecast')),
      el('div', null, el('canvas', { id: 'week' })),
      el('div', { class: 'legend', style: 'margin-top:8px' }, notes.map(([c, s]) => el('span', { style: 'color:' + c }, s))),
      rec.length < 2 ? el('div', { class: 'note' }, 'The recorded line fills in as this report (each run, or every minute with --watch) and the /meter pane save plan readings. Until 45 minutes of readings fall in the last 3 hours, the 3h pace is estimated: the week’s percent per list-price dollar so far, times what the last 3 hours cost.') : null))
    drawWeek = () => {
      const cv = document.getElementById('week'), { g, w, h } = sizeCanvas(cv, 200)
      const top = Math.max(100, atReset(weekPace), recentPace != null ? atReset(recentPace) : 0) * 1.05
      const padL = 44, padB = 20, padT = 10
      const X = (s) => padL + ((s - start) / (r7 - start)) * (w - padL), Y = (p) => padT + (h - padB - padT) * (1 - p / top)
      g.clearRect(0, 0, w, h)
      g.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono')
      g.strokeStyle = C.line; g.fillStyle = C.dim; g.textAlign = 'right'
      for (const p of [0, 25, 50, 75, 100]) { g.beginPath(); g.moveTo(padL, Y(p) + 0.5); g.lineTo(w, Y(p) + 0.5); g.stroke(); g.fillText(p + '%', padL - 6, Y(p) + 4) }
      g.textAlign = 'left'
      for (let d = 1; d <= 7; d++) { const s = start + d * 86400 - 43200; g.fillText(new Date(s * 1000).toLocaleDateString(undefined, { weekday: 'short' }), X(start + (d - 1) * 86400) + 4, h - 5) }
      const line = (pts, color, dash, width) => { g.strokeStyle = color; g.lineWidth = width || 1.5; g.setLineDash(dash ? [6, 5] : []); g.beginPath(); pts.forEach(([s, p], i) => (i ? g.lineTo(X(s), Y(p)) : g.moveTo(X(s), Y(p)))); g.stroke(); g.setLineDash([]); g.lineWidth = 1 }
      line([[start, 0], [r7, 100]], C.dim)
      line([[now, u7], [r7, atReset(weekPace)]], C.amber, true)
      if (recentPace != null) line([[now, u7], [r7, atReset(recentPace)]], C.red, true)
      g.strokeStyle = C.dim; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(now), 0); g.lineTo(X(now), h - padB); g.stroke(); g.setLineDash([])
      if (rec.length > 1) line(rec, C.white, false, 2)
      g.fillStyle = C.white; g.beginPath(); g.arc(X(now), Y(u7), 3.5, 0, 7); g.fill()
    }
  }

  // ---------- when ----------
  const heatMax = Math.max(1e-9, ...R.heat.flat())
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const heat = el('div', { class: 'heat' }, el('em'), Array.from({ length: 24 }, (_, h) => el('em', null, h % 3 === 0 ? String(h) : '')))
  for (let d = 0; d < 7; d++) {
    heat.append(el('em', { style: 'text-align:left' }, days[d]))
    for (let h = 0; h < 24; h++) {
      const v = R.heat[d][h], a = v ? 0.15 + 0.85 * Math.sqrt(v / heatMax) : 0
      const cell = el('span', { style: v ? `background:rgba(88,166,255,${a.toFixed(3)})` : '' })
      cell.onmousemove = (ev) => showTip(ev, `${days[d]} ${h}:00–${h + 1}:00\n${money(v)} all time`)
      cell.onmouseleave = hideTip
      heat.append(cell)
    }
  }

  // ---------- where it goes ----------
  const barList = (rows, color) => {
    const max = Math.max(1e-9, ...rows.map((r) => r.v))
    return el('div', { class: 'bars' }, rows.map((r) => el('div', { class: 'bar', title: r.name },
      el('div', { class: 'name' }, r.name),
      el('div', { class: 'track' }, el('i', { style: `width:${(r.v / max) * 100}%;background:${color || '#58a6ff'}` })),
      el('div', { class: 'val' }, r.label))))
  }
  const share = (v) => (t.total ? ' · ' + pct(v / t.total) : '')
  add('when', el('section', { class: 'grid two' },
    el('div', { class: 'panel' }, el('h2', null, 'When', el('small', null, 'spend by weekday and hour, all time')), heat),
    el('div', { class: 'panel' }, el('h2', null, 'Projects', el('small', null, 'all time')),
      barList(R.projects.slice(0, 12).map((p) => ({ name: p.name, v: p.usd, label: money(p.usd) + share(p.usd) })))),
  ))
  add('models', el('section', { class: 'grid two' },
    el('div', { class: 'panel' }, el('h2', null, 'Models'), barList(R.models.slice(0, 8).map((m) => ({ name: m.name, v: m.usd, label: money(m.usd) + share(m.usd) })), '#a371f7')),
    el('div', { class: 'panel' }, el('h2', null, 'Apps and agents'),
      barList([...R.apps.map((a) => ({ name: a.name, v: a.usd, label: money(a.usd) + share(a.usd) })),
        { name: 'main conversations', v: R.agents.main, label: money(R.agents.main) + share(R.agents.main) },
        { name: 'subagents', v: R.agents.sub, label: money(R.agents.sub) + share(R.agents.sub) }], '#3fb950')),
  ))
  add('context', el('section', { class: 'grid two' },
    el('div', { class: 'panel' }, el('h2', null, 'Context size', el('small', null, 'what each request carried, all time')),
      barList(R.ctx.map((c) => ({ name: c.name, v: c.usd, label: `${money(c.usd)} · ${num(c.n)} req · ${c.n ? money(c.usd / c.n) : '–'} each` })), '#f0883e'),
      el('div', { class: 'note' }, `${num(R.compactions)} compactions · ${num(R.cold.n)} cold restarts costing ${money(R.cold.usd)} extra`)),
    el('div', { class: 'panel' }, el('h2', null, 'Tools', el('small', null, 'calls, all time')),
      barList(R.tools.slice(0, 12).map((x) => ({ name: x.name, v: x.n, label: num(x.n) })), '#8b949e')),
  ))

  // ---------- sessions ----------
  const rows = R.sessions.map((s) => el('tr', null,
    el('td', null, el('div', { class: 'title' }, s.title || s.id.slice(0, 8)), el('div', { class: 'muted' }, `${s.project} · ${s.app}`)),
    el('td', { class: 'num' }, date(s.start)),
    el('td', { class: 'num' }, num(s.n)),
    el('td', { class: 'num' }, tok(s.maxCtx)),
    el('td', { class: 'num' }, s.compactions || ''),
    el('td', { class: 'num' }, s.subUsd > 0.005 ? money(s.subUsd) : ''),
    el('td', { class: 'num' }, s.cold > 0.005 ? money(s.cold) : ''),
    el('td', { class: 'num' }, money(s.usd))))
  add('sessions', el('section', { class: 'panel' },
    el('h2', null, 'Most expensive sessions', el('small', null, `top ${R.sessions.length} of ${num(R.sessionCount)}`)),
    el('div', { class: 'scroll' }, el('table', null,
      el('thead', null, el('tr', null, el('th', null, 'Session'), el('th', { class: 'num' }, 'Started'), el('th', { class: 'num' }, 'Requests'), el('th', { class: 'num' }, 'Max context'), el('th', { class: 'num' }, 'Compactions'), el('th', { class: 'num' }, 'Subagents'), el('th', { class: 'num' }, 'Cold restarts'), el('th', { class: 'num' }, 'Total'))),
      el('tbody', null, rows)))))

  add('footer', el('div', { class: 'note' }, `Generated ${new Date(R.generatedAt * 1000).toLocaleString()} from Claude Code's transcripts on this computer. Dollars are API list prices (cache writes at their 5-minute or 1-hour rate, fast mode at 2×); on a Pro or Max plan they compare habits, they are not a bill.`))

  const only = window.ONLY || new URLSearchParams(location.hash.slice(1)).get('only')
  if (only) { const keep = only.split(','); for (const n of [...app.children]) if (!keep.includes(n.dataset.s)) n.remove() }

  const draw = () => { if (document.getElementById('daily')) drawDaily(); if (drawWeek && document.getElementById('week')) drawWeek() }
  draw()
  addEventListener('resize', draw)
}
