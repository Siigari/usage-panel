// plan.js: the plan's 5-hour and weekly percent. History comes from what the usage-panel mod saved; the live
// reading comes from the same account-usage call Claude Code's /usage screen makes, with this machine's own login.
// Rows are [t, fiveHourPct, weekPct, fiveHourResetSec, weekResetSec], as the mod keeps them.

import fs from 'node:fs'
import path from 'node:path'

export function savedPlan(home) {
  const dir = path.join(home, 'plugins', 'store')
  const rows = []
  let names = []
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith('usage-panel')) } catch {}
  for (const n of names) {
    try {
      const store = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
      for (const [key, value] of Object.entries(store)) if (key.startsWith('plan:') && Array.isArray(value)) rows.push(...value)
    } catch {}
  }
  const seen = new Set()
  return rows.sort((a, b) => a[0] - b[0]).filter((r) => { const k = r.join(','); if (seen.has(k)) return false; seen.add(k); return true })
}

// Undocumented, so anything unexpected just means no live reading
export async function livePlan(home) {
  let token
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(home, '.credentials.json'), 'utf8'))
    token = creds.claudeAiOauth && creds.claudeAiOauth.accessToken
  } catch { return null }
  if (!token) return null
  try {
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const j = await res.json()
    const sec = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : 0)
    const five = j.five_hour, week = j.seven_day
    if (!five && !week) return null
    return [Math.floor(Date.now() / 1000), five ? five.utilization : null, week ? week.utilization : null, sec(five && five.resets_at), sec(week && week.resets_at)]
  } catch { return null }
}

// The report keeps its own readings too, so a measured 3-hour pace and the week's recorded line build up even
// without the /meter pane. Rows older than eight days are dropped.
export function rememberPlan(file, row) {
  let rows = []
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  const last = rows[rows.length - 1]
  const same = last && last[1] === row[1] && last[2] === row[2] && last[4] === row[4]
  if (!same || row[0] - last[0] >= 600) rows.push(row)
  rows = rows.filter((r) => r[0] > row[0] - 8 * 86400)
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(rows)) } catch {}
  return rows
}
