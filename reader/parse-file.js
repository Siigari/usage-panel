// parse-file.js: one transcript in, one compact summary out. Runs inside a worker thread.
//
// A request row is [t, id, model, input, cacheRead, write5m, write1h, output, thinking, webSearches, fast,
//                   kind, trigger, quillCode, quillAgent, dried, rewrite, driedReads, done].
// t is epoch seconds; id is the tail of the API message id, used to drop the same reply seen in two files.
// The fields from 11 on describe why the request happened and what would have saved it (0.3):
//   kind        what sent it: 0 other, 1 a prompt, 2 a tool result handed back, 3 a Stop-hook beat
//   trigger     for kind 2, the tool whose result it carried
//   quillCode   1 if the step before only acted (an edit, a write, git add...), so a Quill-style line would have
//   quillAgent    skipped this request; agent counts sending a message or taking a photo as acting too
//   dried       tokens a seam would have dried by now (old results and big inputs from finished turns)
//   rewrite     tokens a seam would have rewritten to the cache at this request (everything after the first dried point)
//   driedReads  results that were reads, dried at this request (some come back as re-reads)
//   done        1 for pure overhead: a tool result in, under 60 tokens out, and the turn ended

import fs from 'node:fs'
import path from 'node:path'

const CHUNK = 8 * 1024 * 1024
export const CPT = 3.2          // characters per token, for content the transcript doesn't count
const STUB = 20                 // what a dried result leaves behind
const IMG = 1600                // a picture in a tool result
const RIDE_MIN = 2000           // results smaller than this aren't worth listing as riders

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

const tok = (s) => Math.ceil(String(s == null ? '' : s).length / CPT)

// Steps that only act: nothing in their result is needed to go on
const ACT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'TodoWrite', 'TaskCreate', 'TaskUpdate'])
const ACT_SH = /^\s*(mkdir|cp|mv|rm|touch|chmod|git\s+(add|commit|mv|rm|tag|stash\s+push)|cat\s*>|echo\s+.*>\s*\S|printf\s+.*>\s*\S|tee\s)/
const SENDS = /^\s*(node|python3?|bun|deno)\s+\S*(say|send|post|notify|reply|camera|photo|wear|undress)\S*/i
export function isAct(tu, agent) {
  if (ACT_TOOLS.has(tu.name)) return true
  if (tu.name === 'Bash' || tu.name === 'PowerShell') {
    const c = String((tu.input || {}).command || '')
    if (/\|\s*(head|tail|grep|wc|cat)\b/.test(c) || /\b(test|jest|vitest|node\s+--check|npm\s+(run|test)|cargo|pytest)\b/.test(c)) return false
    return c.split(/&&|;/).every((part) => !part.trim() || /^\s*cd\s/.test(part) || ACT_SH.test(part) || (agent && SENDS.test(part)))
  }
  return false
}
// The part of a call's input a seam can dry (its body), in tokens
function bodyTokens(tu) {
  const i = tu.input || {}
  if (tu.name === 'Write') return tok(i.content)
  if (tu.name === 'Edit') return tok(i.old_string) + tok(i.new_string)
  if (tu.name === 'MultiEdit') return (i.edits || []).reduce((a, e) => a + tok(e.old_string) + tok(e.new_string), 0)
  if (tu.name === 'Bash' || tu.name === 'PowerShell') { const c = String(i.command || ''); return c.length > 600 ? tok(c) - 60 : 0 }
  return 0
}
function resultTokens(b) {
  const c = b.content
  if (typeof c === 'string') return tok(c)
  if (Array.isArray(c)) return c.reduce((a, x) => a + (x && x.type === 'image' ? IMG : tok(x && x.text)), 0)
  return 0
}
// What a call was about, for the private report only (the share file never carries it)
function labelOf(tu) {
  const i = tu.input || {}
  return String(i.file_path || i.path || i.url || i.pattern || i.query || i.command || '').split('\n')[0].slice(0, 120)
}
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('') : ''

export function parseFile(file) {
  const parts = file.split(path.sep)
  const isAgent = parts.includes('subagents')
  // A subagent's transcript lives in <project>/<session>/subagents/, so its session is the folder two up
  const session = isAgent ? parts[parts.length - 3] : path.basename(file, '.jsonl')
  // The project folder Claude Code filed it under (stable even when the session's working folder moves)
  const dir = parts[parts.lastIndexOf('projects') + 1] || ''
  let isFork = false
  if (isAgent) { try { isFork = !!JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).isFork } catch {} }
  const out = {
    session, isAgent, cwd: '', title: '', customTitle: '', entry: '', version: '', branch: '',
    reqs: [], compactions: [], tools: {}, first: 0, last: 0,
    // 0.3
    dir, isFork, prompts: 0, riders: [], firstCtx: 0,
    beats: [0, 0, 0],   // Stop-hook beats, their second copies, those copies' tokens; then token-requests the copies rode
  }
  const at = new Map()   // message id -> index in reqs, so a reply split over several lines counts once

  // The chain: what came before each request, and a seam's view of the context
  let pending = 1, trigger = '', prevActCode = false, prevActAgent = false, prevWasReq = false
  let turn = 0, chunks = [], dried = 0
  const tuById = new Map()
  const rides = []            // [tokens, startIndex, endIndex or -1, tool, label]
  const dups = []             // [tokens, startIndex, endIndex or -1]  the second copy of a hook beat
  const endRides = () => { for (const r of rides) if (r[2] < 0) r[2] = out.reqs.length; for (const d of dups) if (d[2] < 0) d[2] = out.reqs.length }
  let lastReq = null          // the row being built (several lines can share it)

  eachLine(file, (l) => {
    const isAsst = l.includes('"type":"assistant"')
    const isCompact = !isAsst && l.includes('"compact_boundary"')
    const isTitle = !isAsst && (l.includes('"ai-title"') || l.includes('"custom-title"'))
    const isUser = !isAsst && !isCompact && !isTitle && l.includes('"type":"user"')
    const isHookErr = !isAsst && !isUser && (l.includes('"hook_blocking_error"') || l.includes('"hook_additional_context"'))
    if (!isAsst && !isCompact && !isTitle && !isUser && !isHookErr) return
    let j
    try { j = JSON.parse(l) } catch { return }

    if (j.type === 'ai-title' && j.aiTitle) { out.title = j.aiTitle; return }
    if (j.type === 'custom-title' && j.customTitle) { out.customTitle = j.customTitle; return }
    const t = Math.floor(Date.parse(j.timestamp) / 1000) || 0
    if (isCompact && j.subtype === 'compact_boundary') {
      const m = j.compactMetadata || {}
      out.compactions.push([t, m.preTokens || 0, m.trigger === 'manual' ? 1 : 0])
      endRides(); chunks = []; dried = 0; prevWasReq = false
      return
    }
    if (j.isSidechain && !isAgent) return
    if (isHookErr) {
      const a = j.attachment
      // A Stop hook that hands back additionalContext: the beat goes in once, as this attachment
      if (a && a.type === 'hook_additional_context' && a.hookEvent === 'Stop') {
        const text = [].concat(a.content || []).join('\n')
        out.beats[0]++; pending = 3; turn++; prevWasReq = false; chunks.push({ turn, kept: tok(text), dry: 0 })
      }
      // A Stop hook that blocks: the reason goes in as "Stop hook feedback" and again as this system reminder
      if (a && a.type === 'hook_blocking_error') {
        const e = a.blockingError && (a.blockingError.blockingError || a.blockingError)
        const n = tok(typeof e === 'string' ? e : JSON.stringify(e || ''))
        out.beats[1]++; out.beats[2] += n
        dups.push([n, out.reqs.length, -1])
      }
      return
    }
    if (isUser) {
      if (j.type !== 'user' || !j.message) return
      const c = j.message.content
      if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) {
        for (const b of c) {
          if (!b || b.type !== 'tool_result') continue
          const tu = tuById.get(b.tool_use_id), n = resultTokens(b)
          if (tu) trigger = trigger || tu.name
          chunks.push({ turn, kept: Math.min(n, STUB), dry: Math.max(0, n - STUB), isRead: !!tu && !isAct(tu, false) })
          if (n >= RIDE_MIN) rides.push([n, out.reqs.length, -1, tu ? tu.name : '?', tu ? labelOf(tu) : ''])
        }
        pending = 2
        return
      }
      const text = textOf(c)
      if (j.isMeta && /^Stop hook feedback:/.test(text)) { out.beats[0]++; pending = 3; turn++; prevWasReq = false; chunks.push({ turn, kept: tok(text), dry: 0 }); return }
      if (j.isMeta || !text.trim() || /^<(local-command|command-name|system-reminder)/.test(text.trim())) return
      out.prompts++; pending = 1; turn++; prevWasReq = false
      chunks.push({ turn, kept: tok(text), dry: 0 })
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

    const tus = []
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) if (b && b.type === 'tool_use' && b.name) { out.tools[b.name] = (out.tools[b.name] || 0) + 1; tus.push(b) }
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
      // Later lines of the same reply carry the final output count, and may add tool calls
      const i = at.get(id), prev = out.reqs[i]
      row[0] = prev[0]
      row[7] = Math.max(prev[7], row[7]); row[8] = Math.max(prev[8], row[8])
      out.reqs[i] = row.concat(prev.slice(11))
      lastReq = { i, tus: lastReq && lastReq.i === i ? lastReq.tus.concat(tus) : tus }
    } else {
      // A new request: why it was sent, and what a Quill line or a seam would have changed
      const kind = pending
      const qc = prevWasReq && kind === 2 && prevActCode ? 1 : 0
      const qa = prevWasReq && kind === 2 && prevActAgent ? 1 : 0
      // The seam dries finished turns' content just before this request goes out
      let first = -1, newReads = 0
      chunks.forEach((c, k) => { if (!c.dried && c.dry > 0 && c.turn < turn) { if (first < 0) first = k; c.dried = true; dried += c.dry; if (c.isRead) newReads++ } })
      let rewrite = 0
      if (first >= 0) for (let k = first; k < chunks.length; k++) rewrite += chunks[k].kept + (chunks[k].dried ? 0 : chunks[k].dry)
      row.push(kind, kind === 2 ? trigger : '', qc, qa, dried, rewrite, newReads, 0)
      if (!out.reqs.length && !isAgent) out.firstCtx = row[3] + row[4] + row[5] + row[6]
      at.set(id, out.reqs.length)
      lastReq = { i: out.reqs.length, tus }
      out.reqs.push(row)
      pending = 0; trigger = ''
    }
    // Recompute what this reply did, from all its lines so far
    const all = lastReq.tus
    for (const tu of tus) tuById.set(tu.id, tu)
    prevActCode = all.length > 0 && all.every((tu) => isAct(tu, false))
    prevActAgent = all.length > 0 && all.every((tu) => isAct(tu, true))
    prevWasReq = true
    let kept = 0, dry = 0
    for (const b of msg.content || []) if (b && b.type === 'text') kept += tok(b.text)
    for (const tu of tus) { const bt = bodyTokens(tu); dry += bt; kept += Math.max(0, tok(JSON.stringify(tu.input || {})) - bt) + 10 }
    if (kept || dry) chunks.push({ turn, kept, dry })
    const r = out.reqs[lastReq.i]
    // A streamed reply's early lines carry no stop reason yet: once it's seen, it stays
    r[18] = (r[18] || msg.stop_reason === 'end_turn') && r[11] === 2 && r[7] < 60 && !all.length ? 1 : 0
  })
  endRides()
  // The biggest riders: tokens times the requests that carried them
  out.riders = rides.map(([n, a, b, tool, label]) => [n, Math.max(0, b - a), tool, label]).filter((r) => r[1] > 0)
    .sort((x, y) => y[0] * y[1] - x[0] * x[1]).slice(0, 10)
  out.beats.push(dups.reduce((s, [n, a, b]) => s + n * Math.max(0, b - a), 0))
  return out
}
