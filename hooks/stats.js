// stats.js: the panel's numbers, worked out from saved rows. No mods API here, so tests can call it directly.
//
// A request row is [t, model, input, cacheRead, cacheWrite, output, session] with t in epoch seconds.
// A plan row is [t, fiveHourPct, weekPct, fiveHourResetSec, weekResetSec].

// List prices in US dollars per million tokens. A cache write is priced at the 1-hour rate (2x input), which is
// what Claude Code uses on a subscription; a cache read is 0.1x input unless the model says otherwise.
const PRICES = [
  [/fable-5-1|mythos-5-1/, { in: 10, out: 50, cr: 0.25 }],
  [/fable|mythos/, { in: 10, out: 50 }],
  [/opus-5-5/, { in: 4, out: 20, cr: 0.2 }],
  [/opus-4-1|opus-4-0|opus-4-2025|opus-4$/, { in: 15, out: 75 }],
  [/opus/, { in: 5, out: 25 }],
  [/sonnet-5/, { in: 2, out: 10 }],
  [/sonnet/, { in: 3, out: 15 }],
  [/haiku-3-5/, { in: 0.8, out: 4 }],
  [/haiku/, { in: 1, out: 5 }],
]
const FALLBACK = { in: 5, out: 25 }

export function priceOf(model) {
  const m = String(model || '').toLowerCase()
  const hit = PRICES.find(([re]) => re.test(m))
  const p = hit ? hit[1] : FALLBACK
  return { in: p.in, out: p.out, cr: p.cr ?? p.in * 0.1, cw: p.in * 2 }
}

// One request's dollars, split the way the panel shows them
export function costOf(row) {
  const p = priceOf(row[1])
  const reads = (row[3] * p.cr) / 1e6
  const writes = (row[4] * p.cw) / 1e6
  const input = (row[2] * p.in) / 1e6
  const output = (row[5] * p.out) / 1e6
  return { reads, writes, input, output, total: reads + writes + input + output }
}

const H = 3600
const sumCost = (rows) => rows.reduce((s, r) => s + costOf(r).total, 0)

export function startOfDay(nowSec) {
  const d = new Date(nowSec * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

// Everything the text blocks show. `rows` is every saved request, `plan` every saved plan reading, both sorted by t.
// `mine` is this session's id, so the context forecast reads this session only.
export function summarize(rows, plan, { now, mine, context }) {
  const since = (sec) => rows.filter((r) => r[0] > now - sec)
  const dayStart = startOfDay(now)
  const today = rows.filter((r) => r[0] >= dayStart)
  const last5m = since(300), last30m = since(1800), last1h = since(H)

  const mix = { reads: 0, writes: 0, input: 0, output: 0 }
  for (const r of today) {
    const c = costOf(r)
    mix.reads += c.reads; mix.writes += c.writes; mix.input += c.input; mix.output += c.output
  }
  const todayUsd = mix.reads + mix.writes + mix.input + mix.output

  // Cache hit: of the prompt tokens read in the last hour, how many came from the cache
  let cr = 0, prompt = 0
  for (const r of last1h) { cr += r[3]; prompt += r[2] + r[3] + r[4] }

  const hourUsd = sumCost(last1h)
  const endOfDayHours = (dayStart + 24 * H - now) / H

  return {
    spend: {
      m5: { usd: sumCost(last5m), n: last5m.length },
      m30: { usd: sumCost(last30m), n: last30m.length },
      h1: { usd: hourUsd, n: last1h.length },
      today: { usd: todayUsd, n: today.length },
    },
    pressure: {
      nowPerHour: sumCost(last5m) * 12,
      hourPace: hourUsd,
      reqPerHour: last1h.length,
      cacheHit: prompt ? cr / prompt : null,
    },
    mix: { ...mix, total: todayUsd },
    forecast: {
      endOfDay: todayUsd + hourUsd * endOfDayHours,
      next24h: hourUsd * 24,
      context: context || null,
      fullIn: contextFullIn(rows.filter((r) => r[6] === mine), now, context),
    },
    plan: planNow(plan, now),
  }
}

// Hours until this session's context reaches its window, from how fast it grew over the last hour
function contextFullIn(rows, now, context) {
  if (!context || !context.tokens || !context.window) return null
  const recent = rows.filter((r) => r[0] > now - H)
  if (recent.length < 2) return null
  const a = recent[0], b = recent[recent.length - 1]
  const ctx = (r) => r[2] + r[3] + r[4]
  const hours = (b[0] - a[0]) / H
  if (hours < 0.1) return null
  const perHour = (ctx(b) - ctx(a)) / hours
  if (perHour <= 0) return null
  return Math.max(0, (context.window - context.tokens) / perHour)
}

// The plan's latest reading and where its week is heading
export function planNow(plan, now) {
  if (!plan.length) return null
  const last = plan[plan.length - 1]
  const [, u5, u7, r5, r7] = last
  const out = { u5, u7, r5, r7, ageMin: Math.round((now - last[0]) / 60) }
  if (u7 == null || !r7) return out
  const weekStart = r7 - 7 * 24 * H
  const elapsed = Math.max(H / 4, now - weekStart)
  out.weekPace = (u7 / elapsed) * H   // points per hour since the week began
  out.recentPace = recentPace(plan, now, r7)
  const pace = out.recentPace ?? out.weekPace
  if (pace > 0) {
    const fullAt = now + ((100 - u7) / pace) * H
    out.fullAt = fullAt < r7 ? fullAt : null
  }
  out.weekPaceAtReset = u7 + out.weekPace * ((r7 - now) / H)
  if (out.recentPace != null) out.recentPaceAtReset = u7 + out.recentPace * ((r7 - now) / H)
  return out
}

// Points per hour over the last three hours, from readings in the same week; null without 45 minutes of readings
function recentPace(plan, now, r7) {
  const same = plan.filter((p) => p[4] === r7 && p[2] != null && p[0] > now - 3 * H)
  if (same.length < 2) return null
  const a = same[0], b = same[same.length - 1]
  if (b[0] - a[0] < 45 * 60) return null
  return (b[2] - a[2]) / ((b[0] - a[0]) / H)
}

// Dollars per bucket for the bar chart, oldest first, split into the four kinds; `ctx` is the largest context
// one of `mine`'s requests in the bucket carried (0 when it made none)
export function buckets(rows, now, count, bucketSec, mine) {
  const end = Math.floor(now / bucketSec) * bucketSec + bucketSec
  const start = end - count * bucketSec
  const out = Array.from({ length: count }, (_, i) => ({ t: start + i * bucketSec, reads: 0, writes: 0, input: 0, output: 0, ctx: 0 }))
  for (const r of rows) {
    if (r[0] < start || r[0] >= end) continue
    const b = out[Math.floor((r[0] - start) / bucketSec)]
    const c = costOf(r)
    b.reads += c.reads; b.writes += c.writes; b.input += c.input; b.output += c.output
    if (r[6] === mine) b.ctx = Math.max(b.ctx, r[2] + r[3] + r[4])
  }
  return out
}

// The week's recorded line: [t, weekPct] for readings in the current week only
export function weekSeries(plan, r7) {
  return plan.filter((p) => p[4] === r7 && p[2] != null).map((p) => [p[0], p[2]])
}
