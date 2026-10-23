// savings.js: where the money went, and what would have saved it (0.3).
// Facts come straight from the transcripts. Estimates replay the same requests under one change each and print
// what they assume. The estimates go after the same rereads, so they overlap: never add them up.

import { priceOf } from '../hooks/stats.js'

const BANDS = [[0, 100e3, '0–100K'], [100e3, 200e3, '100–200K'], [200e3, 300e3, '200–300K'], [300e3, 500e3, '300–500K'], [500e3, Infinity, 'over 500K']]
export const CAPS = [150e3, 200e3, 300e3, 400e3]
export const ASSUME = {
  capSummary: 40000,      // a compaction leaves about this much behind
  capSummaryOut: 8000,    // and writes a summary this long
  toolDefs: 20000,        // tool definitions a session sends with every request (Claude Code 2.1, measured)
  grammar: 1500,          // what a line grammar costs in their place
  reread: 0.10,           // share of dried reads that come back once
}

const ctxOf = (r) => r[3] + r[4] + r[5] + r[6]
// One request's dollars, and the prices behind it (fast mode at 2x, the write rate this session used)
function price(r, w1) {
  const p = priceOf(r[2]), k = r[10] ? 2 : 1
  const w = (w1 ? p.cw : p.cw5) * k
  const total = ((r[3] * p.in + r[4] * p.cr + r[5] * p.cw5 + r[6] * p.cw + r[7] * p.out) * k) / 1e6 + r[9] * 0.01
  return { total, read: (r[4] * p.cr * k) / 1e6, readIn: ((r[4] * p.cr + r[3] * p.in) * k) / 1e6, cr: p.cr * k, w, out: p.out * k }
}

// files: [{ f (the parsed summary), rows (its requests, duplicates already dropped) }]; only rows from `from` on count.
export function savings(files, { from = 0, to = Infinity, assume = ASSUME } = {}) {
  let spend = 0, n = 0
  const bands = BANDS.map(([, , name]) => ({ name, n: 0, usd: 0 }))
  const trips = { n: 0, usd: 0, byTool: {} }, done = { n: 0, usd: 0, byTool: {} }, kinds = [0, 0, 0, 0]
  const riders = [], prefixes = []
  const beats = { n: 0, copies: 0, copyTokens: 0, copyUsd: 0 }
  const forks = { n: 0, usd: 0 }, subs = { n: 0, usd: 0 }
  const cap = CAPS.map((c) => ({ cap: c, usd: 0, compactions: 0 }))
  const quill = { usd: 0, removed: 0, defsUsd: 0, agentFiles: 0, codeFiles: 0 }
  const seam = { saved: 0, rewrite: 0, reread: 0 }

  for (const { f, rows } of files) {
    const rs = rows.filter((r) => r[0] >= from && r[0] < to)
    if (!rs.length) continue
    const w1 = rs.some((r) => r[6] > 0)
    // Agents that live in a Stop-hook loop count sends and photos as acting; prompt-driven sessions don't
    const agent = (f.beats ? f.beats[0] : 0) > (f.prompts || 0)
    if (!f.isAgent) agent ? quill.agentFiles++ : quill.codeFiles++
    const ys = CAPS.map(() => null)
    let prevX = null
    for (const r of rs) {
      const c = price(r, w1), x = ctxOf(r)
      spend += c.total; n++
      const b = BANDS.findIndex(([a, z]) => x >= a && x < z)
      bands[b].n++; bands[b].usd += c.total
      const kind = r[11] || 0
      kinds[kind]++
      if (kind === 2) {
        const tool = r[12] || '?'
        trips.n++; trips.usd += c.total
        const t = trips.byTool[tool] || (trips.byTool[tool] = { n: 0, usd: 0 }); t.n++; t.usd += c.total
        if (r[18]) { done.n++; done.usd += c.total; const d = done.byTool[tool] || (done.byTool[tool] = { n: 0, usd: 0 }); d.n++; d.usd += c.total }
      }
      if (f.isAgent) { const s = f.isFork ? forks : subs; s.n++; s.usd += c.total }

      // A context cap: above it the context starts over near the summary and grows by the same steps
      const d = prevX == null ? null : x - prevX
      prevX = x
      CAPS.forEach((C, k) => {
        if (ys[k] == null || d == null || d < 0) ys[k] = x; else ys[k] += d
        if (ys[k] > C) { ys[k] = assume.capSummary + Math.max(0, d || 0); cap[k].compactions++; cap[k].usd -= (assume.capSummaryOut * c.out + assume.capSummary * c.w) / 1e6 }
        cap[k].usd += (x - Math.min(ys[k], x)) * c.cr / 1e6
      })

      // Fewer round trips: a request after a step that only acted wasn't needed; every other request sheds the tool list
      const gone = agent ? r[14] : r[13]
      if (gone) { quill.removed++; quill.usd += c.readIn }
      else quill.defsUsd += Math.min(assume.toolDefs - assume.grammar, r[4]) * c.cr / 1e6

      // Drying old results: what this request wouldn't have read, minus the rewrite and the re-reads it causes
      if (r.length > 15) {
        seam.saved += Math.min(r[15] || 0, r[4]) * c.cr / 1e6
        seam.rewrite += (r[16] || 0) * Math.max(0, c.w - c.cr) / 1e6
        seam.reread += (r[17] || 0) * assume.reread * c.read
      }
    }
    const p0 = priceOf(rs[0][2])
    for (const [tokens, rides, tool, label] of f.riders || []) riders.push({ tokens, rides, usd: tokens * rides * p0.cr / 1e6, tool, label, project: f.cwd, session: f.session })
    if (f.beats) { beats.n += f.beats[0]; beats.copies += f.beats[1]; beats.copyTokens += f.beats[2]; beats.copyUsd += (f.beats[3] || 0) * p0.cr / 1e6 }
    if (!f.isAgent && f.firstCtx && rs[0] === rows[0]) prefixes.push(f.firstCtx)
  }
  prefixes.sort((a, b) => a - b)
  const over300 = bands[3].usd + bands[4].usd
  const top = (o) => Object.entries(o).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.usd - a.usd)
  return {
    spend, n,
    facts: {
      bands, over300: spend ? over300 / spend : 0,
      trips: { n: trips.n, usd: trips.usd, share: n ? trips.n / n : 0, byTool: top(trips.byTool).slice(0, 12) },
      kinds: { other: kinds[0], prompts: kinds[1], results: kinds[2], beats: kinds[3] },
      done: { n: done.n, usd: done.usd, byTool: top(done.byTool).slice(0, 6) },
      riders: riders.sort((a, b) => b.usd - a.usd).slice(0, 10),
      prefix: prefixes.length ? { median: prefixes[prefixes.length >> 1], sessions: prefixes.length } : null,
      beats, forks, subs,
    },
    estimates: {
      cap: cap.map((c) => ({ ...c, share: spend ? c.usd / spend : 0 })),
      quill: { usd: quill.usd + quill.defsUsd, trips: quill.usd, defs: quill.defsUsd, removed: quill.removed, share: spend ? (quill.usd + quill.defsUsd) / spend : 0, agentFiles: quill.agentFiles, codeFiles: quill.codeFiles },
      seam: { usd: seam.saved - seam.rewrite - seam.reread, saved: seam.saved, rewrite: seam.rewrite, reread: seam.reread, share: spend ? (seam.saved - seam.rewrite - seam.reread) / spend : 0 },
    },
    assume,
  }
}

// Before and after a moment, for one project or all: the receipt for a change
export function compare(files, at, { project } = {}) {
  const pick = files.filter(({ f }) => !project || String(f.cwd || '').toLowerCase().replace(/\\/g, '/').split('/').pop() === project.toLowerCase())
  const side = (from, to) => {
    const s = savings(pick, { from, to })
    const hours = new Set()
    let reread = 0
    for (const { rows } of pick) for (const r of rows) if (r[0] >= from && r[0] < to) { hours.add(Math.floor(r[0] / 3600)); reread += r[4] }
    const h = hours.size || 1
    return {
      requests: s.n, usd: s.spend, activeHours: hours.size, reqPerHour: s.n / h, usdPerHour: s.spend / h, avgReread: s.n ? reread / s.n : 0,
      tripShare: s.facts.trips.share, doneShare: s.n ? s.facts.done.n / s.n : 0, over300: s.facts.over300, bands: s.facts.bands,
    }
  }
  return { at, project: project || null, before: side(0, at), after: side(at, Infinity) }
}
