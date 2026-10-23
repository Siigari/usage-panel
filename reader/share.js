// share.js: a copy of the report that's safe to send someone (--share): numbers, model names and tool names only.
// Projects become Project A, B, C; no session titles, ids, paths, commands or message text. A self-check scans the
// finished files for anything that looks like a path, the home folder, a title or a project name, and refuses if found.

import os from 'node:os'

const letters = (i) => 'Project ' + (i < 26 ? String.fromCharCode(65 + i) : 'A' + (i - 25))

export function anonymize(report) {
  const R = JSON.parse(JSON.stringify(report))
  const names = new Map()
  const alias = (n) => { if (!names.has(n)) names.set(n, letters(names.size)); return names.get(n) }
  for (const p of R.projects) p.name = alias(p.name)
  R.sessions = R.sessions.map((s, i) => ({ ...s, id: 'session-' + (i + 1), title: '', project: alias(s.project) }))
  if (R.live && R.live.forecast && R.live.forecast.context) R.live.forecast.context.title = ''
  if (R.savings) R.savings.facts.riders = R.savings.facts.riders.map((r) => ({ tokens: r.tokens, rides: r.rides, usd: r.usd, tool: r.tool, label: '' }))
  // Tool names stay, except an MCP tool's server part can name something private: keep only the tool
  const tool = (n) => String(n).startsWith('mcp__') ? 'mcp:' + String(n).split('__').pop() : n
  R.tools = R.tools.map((t) => ({ ...t, name: tool(t.name) }))
  if (R.savings) {
    R.savings.facts.trips.byTool = R.savings.facts.trips.byTool.map((t) => ({ ...t, name: tool(t.name) }))
    R.savings.facts.done.byTool = R.savings.facts.done.byTool.map((t) => ({ ...t, name: tool(t.name) }))
    R.savings.facts.riders = R.savings.facts.riders.map((r) => ({ ...r, tool: tool(r.tool) }))
  }
  R.findings = R.findings.map((f) => ({ ...f, title: scrubText(f.title), detail: scrubText(f.detail) }))
  R.shared = true
  return { report: R, secrets: [...names.keys()], titles: report.sessions.map((s) => s.title).filter(Boolean) }
}
const scrubText = (s) => String(s).replace(/mcp__[\w-]+__/g, 'mcp:')

// The same numbers as plain markdown, for pasting
export function shareMarkdown(R) {
  const $ = (d) => '$' + (d >= 100 ? Math.round(d).toLocaleString('en-US') : d.toFixed(2))
  const p = (f) => Math.round(f * 100) + '%'
  const lines = [`# Claude Code usage (shared copy)`, '', `Last ${R.recent.days} days: ${$(R.recent.total)} at API list prices over ${R.recent.n.toLocaleString('en-US')} requests.`, '']
  lines.push('## Grades', ...R.grades.map((g) => `- ${g.name}: ${g.grade} (${g.value} ${g.note})`), '')
  const S = R.savings
  if (S) {
    const F = S.facts, E = S.estimates
    lines.push('## Where it went', `- ${p(F.over300)} of spend happened while a session carried more than 300K`)
    for (const b of F.bands) lines.push(`- ${b.name}: ${$(b.usd)} (${b.n} requests)`)
    lines.push(`- Round trips: ${p(F.trips.share)} of requests handed a tool result back (${$(F.trips.usd)})`)
    lines.push(`- "Done" requests: ${F.done.n} (${$(F.done.usd)})`)
    if (F.prefix) lines.push(`- A fresh session starts at ~${Math.round(F.prefix.median / 1000)}K tokens`)
    lines.push('', '## What would have saved it (estimates; they overlap, don’t add them)')
    lines.push(`- Context cap: ${E.cap.map((c) => `${c.cap / 1000}K ${p(c.share)}`).join(', ')}`)
    lines.push(`- Fewer round trips: ${$(E.quill.usd)} (${p(E.quill.share)})`)
    lines.push(`- Drying old results: ${$(E.seam.usd)} (${p(E.seam.share)})`)
  }
  lines.push('', '## Findings', ...R.findings.map((f) => `- ${f.title}`))
  lines.push('', '## Models', ...R.models.slice(0, 6).map((m) => `- ${m.name}: ${$(m.usd)}`))
  return lines.join('\n') + '\n'
}

// Every string value in the shared data (keys are the report's own field names, not the person's)
function values(x, out = []) {
  if (typeof x === 'string') out.push(x)
  else if (Array.isArray(x)) for (const v of x) values(v, out)
  else if (x && typeof x === 'object') for (const v of Object.values(x)) values(v, out)
  return out
}

// Anything that could identify the person or their work. Returns what it found (empty means safe).
// report: the anonymized data; texts: anything else written (the markdown).
export function selfCheck(report, texts = [], { secrets = [], titles = [], home = os.homedir() } = {}) {
  const found = []
  const user = home.split(/[\\/]/).pop().toLowerCase()
  const homes = [home, home.replace(/\\/g, '/')].map((h) => h.toLowerCase())
  const names = secrets.filter((s) => s && s !== '(unknown)').map((s) => s.toLowerCase())
  const PATH = /(?:\b[A-Za-z]:[\\/]{1,2}[\w .-]+|(?:^|[\s"'(])\/(?:Users|home|mnt|var|opt|srv)\/[\w.-]+)/m
  const vals = values(report)
  // A project's real name may be a common word (tools, web): it's a leak only as a whole value or a path part
  for (const v of vals) {
    const lv = v.toLowerCase()
    for (const n of names) if (lv === n || lv.split(/[\\/]/).includes(n)) found.push(n)
  }
  for (const t of [...vals, ...texts]) {
    const lt = t.toLowerCase()
    for (const h of homes) if (h.length > 3 && lt.includes(h)) found.push('home folder')
    if (user.length > 2 && new RegExp(`[\\\\/]${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\\\/]|$)`).test(lt)) found.push('home folder name')
    for (const ti of titles) if (ti.length > 6 && t.includes(ti)) found.push('a session title')
    const p = PATH.exec(t)
    if (p) found.push(p[0].trim())
  }
  return [...new Set(found)]
}
