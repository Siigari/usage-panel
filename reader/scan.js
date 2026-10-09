// scan.js: finds every Claude Code transcript on this machine and parses the ones that changed since last time.
// The parsed summaries are cached next to the report, so a second run only reads active sessions.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { parseFile } from './parse-file.js'

const CACHE_VERSION = 1

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

function listTranscripts(root) {
  const files = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.jsonl')) {
        try { const s = fs.statSync(p); files.push({ file: p, size: s.size, mtimeMs: Math.floor(s.mtimeMs) }) } catch {}
      }
    }
  }
  walk(root)
  return files
}

function loadCache(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (c.version === CACHE_VERSION) return c
  } catch {}
  return { version: CACHE_VERSION, files: {} }
}

// Parses `todo` across a pool of worker threads; resolves to { file: summary }
function parseAll(todo, onProgress) {
  if (!todo.length) return Promise.resolve({})
  const size = Math.max(1, Math.min(16, os.cpus().length, todo.length))
  // Biggest first, so one huge transcript doesn't start last
  const queue = [...todo].sort((a, b) => b.size - a.size)
  const results = {}
  let done = 0
  return new Promise((resolve, reject) => {
    let live = size
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL(import.meta.url))
      const feed = () => {
        const next = queue.shift()
        if (next) w.postMessage(next.file)
        else { w.terminate(); if (--live === 0) resolve(results) }
      }
      w.on('message', ({ file, summary, error }) => {
        if (summary) results[file] = summary
        else if (error) results[file] = null
        done++
        if (onProgress) onProgress(done, todo.length)
        feed()
      })
      w.on('error', reject)
      feed()
    }
  })
}

export async function scanAll({ home = claudeHome(), cacheFile, onProgress } = {}) {
  const root = path.join(home, 'projects')
  const files = listTranscripts(root)
  const cache = loadCache(cacheFile)
  const todo = files.filter((f) => {
    const c = cache.files[f.file]
    return !c || c.size !== f.size || c.mtimeMs !== f.mtimeMs
  })
  const parsed = await parseAll(todo, onProgress)
  const next = { version: CACHE_VERSION, files: {} }
  for (const f of files) {
    const s = f.file in parsed ? parsed[f.file] : cache.files[f.file] && cache.files[f.file].summary
    if (s) next.files[f.file] = { size: f.size, mtimeMs: f.mtimeMs, summary: s }
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
  fs.writeFileSync(cacheFile, JSON.stringify(next))
  return {
    root,
    fileCount: files.length,
    bytes: files.reduce((s, f) => s + f.size, 0),
    parsedNow: todo.length,
    summaries: Object.values(next.files).map((f) => f.summary),
  }
}

// Worker side: parse each file the main thread sends
if (!isMainThread && parentPort) {
  parentPort.on('message', (file) => {
    try { parentPort.postMessage({ file, summary: parseFile(file) }) }
    catch (e) { parentPort.postMessage({ file, error: String(e && e.message || e) }) }
  })
}
