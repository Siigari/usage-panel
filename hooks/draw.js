// draw.js: turns the numbers into an element tree. No mods API here: the hook passes in the elements it resolved,
// so this file only builds trees, Raster cells, and SVG text.

import { buckets, weekSeries } from './stats.js'

export const C = {
  title: '#58a6ff',
  label: '#8b949e',
  value: '#e6edf3',
  dim: '#6e7681',
  reads: '#58a6ff',
  writes: '#f0883e',
  input: '#a371f7',
  output: '#3fb950',
  ctx: '#e6edf3',
  even: '#6e7681',
  weekPace: '#d29922',
  recentPace: '#f85149',
  recorded: '#ffffff',
  barUsed: '#3fb950',
  barWarm: '#d29922',
  barHot: '#f85149',
  barEmpty: '#30363d',
}

const DEFAULT = 0x01000000
const hex = (c) => parseInt(c.slice(1), 16)
const H = 3600
const BUCKET = 300

// ---------- words ----------

export function money(d) {
  if (d == null || !isFinite(d)) return '–'
  return '$' + d.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function tokens(n) {
  if (!n) return '0'
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}
const pct = (p) => (p == null ? '–' : Math.round(p) + '%')
const clock = (sec) => new Date(sec * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dayHour = (sec) => {
  const d = new Date(sec * 1000)
  const day = d.toLocaleDateString('en-US', { weekday: 'short' })
  const h = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined })
  return day + ' ' + h
}
const hourLabel = (sec) => new Date(sec * 1000).toLocaleTimeString('en-US', { hour: 'numeric' })
const dayLabel = (sec) => new Date(sec * 1000).toLocaleDateString('en-US', { weekday: 'short' })

// ---------- the text blocks ----------

const BLOCK = 27

function row(E, label, value, color) {
  return E.Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: BLOCK,
    children: [
      E.Text({ color: C.label, wrap: 'truncate-end', children: [label] }),
      E.Text({ color: color || C.value, children: [value] }),
    ],
  })
}

function block(E, title, note, rows) {
  const head = [E.Text({ color: C.title, bold: true, children: [title] })]
  if (note) head.push(E.Text({ color: C.dim, children: [' ' + note] }))
  return E.Box({
    flexDirection: 'column',
    width: BLOCK,
    children: [E.Box({ flexDirection: 'row', children: head }), ...rows],
  })
}

function meter(E, p) {
  const n = BLOCK, used = Math.max(0, Math.min(n, Math.round(((p || 0) / 100) * n)))
  const color = p >= 90 ? C.barHot : p >= 67 ? C.barWarm : C.barUsed
  return E.Box({
    flexDirection: 'row',
    children: [
      E.Text({ color, children: ['━'.repeat(used)] }),
      E.Text({ color: C.barEmpty, children: ['━'.repeat(n - used)] }),
    ],
  })
}

function blocks(E, s) {
  const { spend, pressure, mix, forecast, plan } = s
  const share = (v) => (mix.total ? Math.round((v / mix.total) * 100) + '%' : '–')
  const out = [
    block(E, 'SPEND', 'list $', [
      row(E, '5m', `${money(spend.m5.usd)} · ${spend.m5.n} req`),
      row(E, '30m', `${money(spend.m30.usd)} · ${spend.m30.n} req`),
      row(E, '1h', `${money(spend.h1.usd)} · ${spend.h1.n} req`),
      row(E, 'today', `${money(spend.today.usd)} · ${spend.today.n} req`),
    ]),
    block(E, 'PRESSURE', '', [
      row(E, 'now', money(pressure.nowPerHour) + '/h'),
      row(E, '1h pace', money(pressure.hourPace) + '/h'),
      row(E, 'req/h', String(pressure.reqPerHour)),
      row(E, 'cache hit', pressure.cacheHit == null ? '–' : Math.round(pressure.cacheHit * 100) + '%'),
    ]),
    block(E, "TODAY'S MIX", '', [
      row(E, 'reads', `${money(mix.reads)} · ${share(mix.reads)}`, C.reads),
      row(E, 'writes', `${money(mix.writes)} · ${share(mix.writes)}`, C.writes),
      row(E, 'input', `${money(mix.input)} · ${share(mix.input)}`, C.input),
      row(E, 'output', `${money(mix.output)} · ${share(mix.output)}`, C.output),
    ]),
    block(E, 'FORECAST', '', [
      row(E, 'end of day', '~' + money(forecast.endOfDay)),
      row(E, 'next 24h', '~' + money(forecast.next24h)),
      row(E, 'context', forecast.context && forecast.context.tokens != null ? `${tokens(forecast.context.tokens)} / ${tokens(forecast.context.window)}` : '–'),
      row(E, 'full in', forecast.fullIn == null ? '–' : '~' + forecast.fullIn.toFixed(1) + ' h'),
    ]),
  ]
  if (plan) {
    const fc = plan.fullAt ? 'full ' + dayHour(plan.fullAt) : plan.u7 != null ? 'lasts to reset' : '–'
    out.push(block(E, 'PLAN', 'whole account', [
      row(E, '5-hour', `${pct(plan.u5)}  ↻ ${plan.r5 ? clock(plan.r5) : '–'}`),
      meter(E, plan.u5),
      row(E, 'weekly', `${pct(plan.u7)}  ↻ ${plan.r7 ? dayHour(plan.r7) : '–'}`),
      meter(E, plan.u7),
      row(E, 'forecast', fc, plan.fullAt ? C.weekPace : C.value),
    ]))
  } else {
    out.push(block(E, 'PLAN', 'whole account', [
      E.Text({ color: C.dim, wrap: 'wrap', children: ['Shows after the next reply on a Pro or Max plan.'] }),
    ]))
  }
  return E.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, rowGap: 1, children: out })
}

// ---------- Raster helpers (terminal) ----------

function pack(words) {
  return new Uint8Array(Uint32Array.from(words).buffer).toBase64()
}

// A line of text laid out by column: each [col, text] is written at its column, later ones skipped if they'd overlap
function ruler(cols, marks) {
  const line = Array(cols).fill(' ')
  let free = 0
  for (const [col, text] of marks) {
    if (col < free || col + text.length > cols) continue
    for (let i = 0; i < text.length; i++) line[col + i] = text[i]
    free = col + text.length + 1
  }
  return line.join('')
}

// ---------- the spend chart ----------

const KINDS = ['reads', 'writes', 'input', 'output']

function spendRaster(E, bs, cols, rows, window) {
  const max = Math.max(0.01, ...bs.map((b) => b.reads + b.writes + b.input + b.output))
  const units = rows * 8
  const cells = new Array(cols * rows * 3)
  for (let x = 0; x < cols; x++) {
    const b = bs[x]
    // Boundaries in eighths of a cell, bottom up: where each kind ends
    let acc = 0
    const tops = KINDS.map((k) => (acc += b[k], Math.round((acc / max) * units)))
    const colorAt = (u) => { const i = tops.findIndex((t) => u < t); return i < 0 ? null : hex(C[KINDS[i]]) }
    const ctxRow = b.ctx && window ? Math.min(rows - 1, Math.floor((b.ctx / window) * rows)) : -1
    for (let r = 0; r < rows; r++) {
      const lo = r * 8, y = rows - 1 - r, at = (y * cols + x) * 3
      const below = colorAt(lo)
      let ch = 0x20, fg = DEFAULT, bg = DEFAULT
      if (below != null) {
        const next = tops.find((t) => t > lo && t < lo + 8)
        if (next == null) { ch = 0x2588; fg = below }
        else { ch = 0x2580 + (next - lo); fg = below; const above = colorAt(next); bg = above == null ? DEFAULT : above }
      }
      if (r === ctxRow) { bg = fg === DEFAULT ? bg : fg; ch = 0x2500; fg = hex(C.ctx) }
      cells[at] = ch; cells[at + 1] = fg; cells[at + 2] = bg
    }
  }
  return { raster: E.Raster({ key: 'spend', columns: cols, rows, cells: pack(cells) }), max }
}

function spendSvg(E, bs, width, height, window) {
  const max = Math.max(0.01, ...bs.map((b) => b.reads + b.writes + b.input + b.output))
  const bw = width / bs.length
  let rects = ''
  let ctxPts = []
  bs.forEach((b, i) => {
    let y = height
    for (const k of KINDS) {
      const h = (b[k] / max) * height
      if (h > 0.2) rects += `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${C[k]}"/>`
      y -= h
    }
    if (b.ctx && window) ctxPts.push(`${(i * bw + bw / 2).toFixed(1)},${(height - (b.ctx / window) * height).toFixed(1)}`)
  })
  const line = ctxPts.length > 1 ? `<polyline points="${ctxPts.join(' ')}" fill="none" stroke="${C.ctx}" stroke-width="1.5"/>` : ''
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects}${line}</svg>`
  return { svg: E.Svg({ source, alt: 'Spend per five minutes, stacked by reads, writes, input, and output', width, height }), max }
}

function spendChart(E, svgMode, data, cols) {
  const count = Math.max(12, cols)
  const bs = buckets(data.rows, data.now, count, BUCKET, data.mine)
  const window = data.context && data.context.window
  const legend = E.Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      ...KINDS.map((k) => E.Text({ color: C[k], children: ['■ ' + k] })),
      E.Text({ color: C.ctx, children: ['─ context'] }),
    ],
  })
  const chart = svgMode ? spendSvg(E, bs, cols * 8, 110, window) : spendRaster(E, bs, cols, 7, window)
  const marks = []
  bs.forEach((b, i) => { if (b.t % H === 0) marks.push([i, hourLabel(b.t)]) })
  const ctxNote = data.context && data.context.tokens ? `  ·  this session ${tokens(data.context.tokens)} ctx` : ''
  return [
    legend,
    E.Text({ color: C.dim, children: [`top = ${money(chart.max)} per 5 min${ctxNote}`] }),
    chart.raster || chart.svg,
    svgMode ? null : E.Text({ color: C.dim, children: [ruler(cols, marks)] }),
  ].filter(Boolean)
}

// ---------- the week chart ----------

// Braille canvas: each cell is 2 dots wide and 4 tall; a cell takes the color of the last line drawn through it
function canvas(cols, rows) {
  const W = cols * 2, Hh = rows * 4
  const bits = new Uint8Array(cols * rows)
  const color = new Uint32Array(cols * rows).fill(DEFAULT)
  const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
  function dot(x, y, c) {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || y < 0 || x >= W || y >= Hh) return
    const i = Math.floor(y / 4) * cols + Math.floor(x / 2)
    bits[i] |= DOT[y % 4][x % 2]
    color[i] = c
  }
  function line(x0, y0, x1, y1, c, dash) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))
    for (let s = 0; s <= steps; s++) {
      if (dash && Math.floor(s / 3) % 2 === 1) continue
      dot(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, c)
    }
  }
  function cells() {
    const out = new Array(cols * rows * 3)
    for (let i = 0; i < cols * rows; i++) {
      out[i * 3] = bits[i] ? 0x2800 + bits[i] : 0x20
      out[i * 3 + 1] = bits[i] ? color[i] : DEFAULT
      out[i * 3 + 2] = DEFAULT
    }
    return out
  }
  return { W, H: Hh, dot, line, cells }
}

function weekLines(plan, now) {
  const r7 = plan.r7, start = r7 - 7 * 24 * H
  const lines = [{ color: C.even, dash: false, pts: [[start, 0], [r7, 100]] }]
  lines.push({ color: C.weekPace, dash: true, pts: [[now, plan.u7], [r7, plan.weekPaceAtReset]] })
  if (plan.recentPaceAtReset != null) lines.push({ color: C.recentPace, dash: true, pts: [[now, plan.u7], [r7, plan.recentPaceAtReset]] })
  return { start, lines }
}

function weekRaster(E, data, plan, cols, rows) {
  const cv = canvas(cols, rows)
  const { start, lines } = weekLines(plan, data.now)
  const X = (t) => ((t - start) / (plan.r7 - start)) * (cv.W - 1)
  const Y = (p) => (cv.H - 1) - (Math.min(100, Math.max(0, p)) / 100) * (cv.H - 1)
  // A forecast past 100% is drawn to where it crosses 100%, then stops
  const clip = ([t0, p0], [t1, p1]) => (p1 <= 100 || p1 === p0 ? [[t0, p0], [t1, p1]] : [[t0, p0], [t0 + ((100 - p0) / (p1 - p0)) * (t1 - t0), 100]])
  for (let y = 0; y < cv.H; y += 2) cv.dot(X(data.now), y, hex(C.dim))
  for (const l of lines) { const [a, b] = clip(l.pts[0], l.pts[1]); cv.line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), hex(l.color), l.dash) }
  const rec = weekSeries(data.plan, plan.r7)
  for (let i = 1; i < rec.length; i++) cv.line(X(rec[i - 1][0]), Y(rec[i - 1][1]), X(rec[i][0]), Y(rec[i][1]), hex(C.recorded), false)
  if (rec.length) cv.dot(X(rec[rec.length - 1][0]), Y(rec[rec.length - 1][1]), hex(C.recorded))
  const marks = []
  for (let d = 0; d <= 7; d++) {
    const t = new Date(start * 1000); t.setDate(t.getDate() + d); t.setHours(0, 0, 0, 0)
    const sec = t.getTime() / 1000
    if (sec > start && sec < plan.r7) marks.push([Math.round(X(sec) / 2), dayLabel(sec)])
  }
  return [
    E.Raster({ key: 'week', columns: cols, rows, cells: pack(cv.cells()) }),
    E.Text({ color: C.dim, children: [ruler(cols, marks)] }),
  ]
}

function weekSvg(E, data, plan, width, height) {
  const { start, lines } = weekLines(plan, data.now)
  const X = (t) => ((t - start) / (plan.r7 - start)) * width
  const Y = (p) => height - (Math.min(130, Math.max(0, p)) / 130) * height
  let body = `<line x1="0" y1="${Y(100)}" x2="${width}" y2="${Y(100)}" stroke="${C.barEmpty}"/>`
  body += `<line x1="${X(data.now)}" y1="0" x2="${X(data.now)}" y2="${height}" stroke="${C.dim}" stroke-dasharray="2 3"/>`
  for (const l of lines) body += `<line x1="${X(l.pts[0][0])}" y1="${Y(l.pts[0][1])}" x2="${X(l.pts[1][0])}" y2="${Y(l.pts[1][1])}" stroke="${l.color}" stroke-width="1.5"${l.dash ? ' stroke-dasharray="5 4"' : ''}/>`
  const rec = weekSeries(data.plan, plan.r7)
  if (rec.length > 1) body += `<polyline points="${rec.map(([t, p]) => `${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.recorded}" stroke-width="2"/>`
  for (let d = 1; d < 7; d++) {
    const t = new Date(start * 1000); t.setDate(t.getDate() + d); t.setHours(0, 0, 0, 0)
    const sec = t.getTime() / 1000
    if (sec < plan.r7) body += `<text x="${X(sec) + 3}" y="${height - 3}" fill="${C.dim}" font-size="10" font-family="sans-serif">${dayLabel(sec)}</text>`
  }
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  return [E.Svg({ source, alt: 'The plan week: even pace, recorded use, and two forecasts', width, height })]
}

function weekChart(E, svgMode, data, cols) {
  const plan = data.summary.plan
  if (!plan || plan.u7 == null || !plan.r7) return []
  const even = ((data.now - (plan.r7 - 7 * 24 * H)) / (7 * 24 * H)) * 100
  const ahead = plan.u7 - even
  const fullNote = (at) => (at >= 100 ? ` (full ${dayHour(data.now + ((100 - plan.u7) / ((at - plan.u7) / ((plan.r7 - data.now) / H))) * H)})` : '')
  const notes = [
    E.Text({ color: C.value, children: [`now ${pct(plan.u7)}, ${Math.abs(Math.round(ahead))} pts ${ahead >= 0 ? 'ahead of' : 'behind'} even pace`] }),
    E.Text({ color: C.weekPace, children: [`week pace → ${pct(plan.weekPaceAtReset)} at reset${fullNote(plan.weekPaceAtReset)}`] }),
  ]
  if (plan.recentPaceAtReset != null) notes.push(E.Text({ color: C.recentPace, children: [`3h pace → ${pct(plan.recentPaceAtReset)} at reset${fullNote(plan.recentPaceAtReset)}`] }))
  notes.push(E.Text({ color: C.dim, children: [`resets ${dayHour(plan.r7)}`] }))
  const head = E.Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      E.Text({ color: C.title, bold: true, children: ['THIS WEEK'] }),
      E.Text({ color: C.dim, wrap: 'truncate-end', children: ['grey = even pace · white = recorded · dashed = forecast · top = 100%'] }),
    ],
  })
  const chart = svgMode ? weekSvg(E, data, plan, cols * 8, 120) : weekRaster(E, data, plan, cols, 6)
  return [head, ...chart, ...notes]
}

// ---------- the whole pane ----------

export function drawPanel(E, surface, cols, data) {
  const svgMode = !(surface === 'terminal' && E.Raster) && !!E.Svg
  const width = Math.max(20, Math.min(cols || 80, 200))
  const kids = [blocks(E, data.summary)]
  if (!data.rows.length) {
    kids.push(E.Text({ color: C.dim, wrap: 'wrap', children: ['No requests recorded yet. The numbers start with your next message, in any session with this plugin on.'] }))
  } else if (svgMode || E.Raster) {
    kids.push(E.Text({ children: [' '] }), ...spendChart(E, svgMode, data, width))
  }
  const week = svgMode || E.Raster ? weekChart(E, svgMode, data, width) : []
  if (week.length) kids.push(E.Text({ children: [' '] }), ...week)
  return E.Box({ flexDirection: 'column', children: kids })
}
