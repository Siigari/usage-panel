// parse-file.js: one transcript in, one compact summary out. Runs inside a worker thread.
//
// A request row is [t, id, model, input, cacheRead, write5m, write1h, output, thinking, webSearches, fast].
// t is epoch seconds; id is the tail of the API message id, used to drop the same reply seen in two files.

import fs from 'node:fs'
import path from 'node:path'

const CHUNK = 8 * 1024 * 1024

// Calls fn(line) for each line, reading in chunks so a file of any size fits in memory
function eachLine(file, fn) {
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(CHUNK)
  let rest = ''
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CHUNK, null)
      if (n === 0) break
      const text = rest + buf.toString('utf8', 0, n)
      const lines = text.split('\n')
      rest = lines.pop()
      for (const l of lines) fn(l)
    }
    if (rest) fn(rest)
  } finally {
    fs.closeSync(fd)
  }
}

export function parseFile(file) {
  const parts = file.split(path.sep)
  const isAgent = parts.includes('subagents')
  // A subagent's transcript lives in <project>/<session>/subagents/, so its session is the folder two up
  const session = isAgent ? parts[parts.length - 3] : path.basename(file, '.jsonl')
  const out = {
    session, isAgent, cwd: '', title: '', customTitle: '', entry: '', version: '', branch: '',
    reqs: [], compactions: [], tools: {}, first: 0, last: 0,
  }
  const at = new Map()   // message id -> index in reqs, so a reply split over several lines counts once

  eachLine(file, (l) => {
    const isAsst = l.includes('"type":"assistant"')
    const isCompact = !isAsst && l.includes('"compact_boundary"')
    const isTitle = !isAsst && (l.includes('"ai-title"') || l.includes('"custom-title"'))
    if (!isAsst && !isCompact && !isTitle) return
    let j
    try { j = JSON.parse(l) } catch { return }

    if (j.type === 'ai-title' && j.aiTitle) { out.title = j.aiTitle; return }
    if (j.type === 'custom-title' && j.customTitle) { out.customTitle = j.customTitle; return }
    const t = Math.floor(Date.parse(j.timestamp) / 1000) || 0
    if (isCompact && j.subtype === 'compact_boundary') {
      const m = j.compactMetadata || {}
      out.compactions.push([t, m.preTokens || 0, m.trigger === 'manual' ? 1 : 0])
      return
    }
    if (j.type !== 'assistant' || !j.message) return
    const msg = j.message, u = msg.usage
    if (!u || !msg.model || msg.model.startsWith('<')) return

    if (j.cwd) out.cwd = j.cwd
    if (j.entrypoint) out.entry = j.entrypoint
    if (j.version) out.version = j.version
    if (j.gitBranch) out.branch = j.gitBranch
    if (!out.first || t < out.first) out.first = t
    if (t > out.last) out.last = t

    if (Array.isArray(msg.content)) {
      for (const b of msg.content) if (b && b.type === 'tool_use' && b.name) out.tools[b.name] = (out.tools[b.name] || 0) + 1
    }

    const cc = u.cache_creation
    const cw = u.cache_creation_input_tokens || 0
    const w1 = cc ? cc.ephemeral_1h_input_tokens || 0 : 0
    const w5 = cc ? cc.ephemeral_5m_input_tokens || 0 : cw
    const think = (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0
    const web = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0
    const id = String(msg.id || j.requestId || j.uuid).slice(-14)
    const row = [t, id, msg.model, u.input_tokens || 0, u.cache_read_input_tokens || 0, w5, w1, u.output_tokens || 0, think, web, u.speed === 'fast' ? 1 : 0]
    if (at.has(id)) {
      // Later lines of the same reply carry the final output count
      const i = at.get(id), prev = out.reqs[i]
      row[0] = prev[0]
      row[7] = Math.max(prev[7], row[7]); row[8] = Math.max(prev[8], row[8])
      out.reqs[i] = row
    } else {
      at.set(id, out.reqs.length)
      out.reqs.push(row)
    }
  })
  return out
}
