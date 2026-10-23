// node --test tests/reader.test.mjs — the report's reader on made-up transcripts (never real data).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile } from '../reader/parse-file.js'
import { savings, compare } from '../reader/savings.js'
import { anonymize, shareMarkdown, selfCheck } from '../reader/share.js'
import { evaluate } from '../reader/evaluate.js'

const T0 = Date.parse('2026-10-20T10:00:00Z')
let clock = 0, n = 0
const ts = () => new Date(T0 + (clock += 5000)).toISOString()
const usage = (ctx, out = 200) => ({ input_tokens: 2, cache_read_input_tokens: ctx, cache_creation_input_tokens: 500, cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 }, output_tokens: out })
const asst = (ctx, content, { out = 200, stop = 'end_turn', id } = {}) => ({ type: 'assistant', timestamp: ts(), cwd: '/home/pat/shop', message: { id: id || 'msg_' + ++n, model: 'claude-opus-5-5', usage: usage(ctx, out), content, stop_reason: stop } })
const prompt = (text) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: text } })
const result = (id, text) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } })
const call = (id, name, input) => ({ type: 'tool_use', id, name, input })
const beat = (text) => [
  { type: 'user', isMeta: true, timestamp: ts(), message: { role: 'user', content: 'Stop hook feedback:\n' + text } },
  { type: 'attachment', timestamp: ts(), attachment: { type: 'hook_blocking_error', hookEvent: 'Stop', blockingError: { blockingError: text } } },
]
const context = (text) => ({ type: 'attachment', timestamp: ts(), attachment: { type: 'hook_additional_context', hookEvent: 'Stop', content: [text] } })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-reader-'))
function write(name, lines) {
  const f = path.join(dir, 'projects', '-home-pat-shop', name)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.flat().map((l) => JSON.stringify(l)).join('\n') + '\n')
  return f
}

// A coding session: prompt, a Read (needs its result), an Edit (only acts), "done", a big result, a compaction
const big = 'x'.repeat(32000)   // 10K tokens at 3.2 chars a token
const coding = write('s1.jsonl', [
  prompt('fix the order total'),
  // one reply split over two lines with the same id: counts once, the higher output wins
  asst(30000, [{ type: 'text', text: 'Looking.' }], { out: 10, stop: null, id: 'msg_split' }),
  asst(30000, [call('t1', 'Read', { file_path: '/home/pat/shop/src/orders.ts' })], { out: 120, stop: 'tool_use', id: 'msg_split' }),
  result('t1', big),
  asst(40000, [call('t2', 'Edit', { file_path: '/home/pat/shop/src/orders.ts', old_string: 'a', new_string: 'b' })], { stop: 'tool_use' }),
  result('t2', 'The file was updated.'),
  asst(41000, [{ type: 'text', text: 'Done.' }], { out: 20 }),
  prompt('and the tax'),
  asst(42000, [{ type: 'text', text: 'Sure.' }]),
  asst(43000, [{ type: 'text', text: 'More.' }]),
  { type: 'system', subtype: 'compact_boundary', timestamp: ts(), compactMetadata: { preTokens: 43000, trigger: 'auto' } },
  prompt('after the compaction'),
  asst(9000, [{ type: 'text', text: 'Fresh.' }]),
])

// An agent in a hook loop: blocking beats (sent twice), a send that only acts, then an additionalContext beat
const agent = write('s2.jsonl', [
  prompt('wake up'),
  asst(20000, [{ type: 'text', text: 'hi' }]),
  beat('[discord] pat: hello there friend'),
  asst(21000, [call('a1', 'Bash', { command: 'node discord/say.js general "hi pat"' })], { stop: 'tool_use' }),
  result('a1', 'sent'),
  asst(22000, [{ type: 'text', text: 'ok' }], { out: 5 }),
  beat('[tick] nothing new'),
  asst(23000, [{ type: 'text', text: 'quiet' }]),
  context('[discord] pat: one copy only'),
  asst(24000, [{ type: 'text', text: 'got it' }]),
])

// A fork: a subagent whose meta says it inherited its parent
const forkFile = path.join(dir, 'projects', '-home-pat-shop', 's1', 'subagents', 'agent-f1.jsonl')
fs.mkdirSync(path.dirname(forkFile), { recursive: true })
fs.writeFileSync(forkFile, JSON.stringify({ ...asst(60000, [{ type: 'text', text: 'forked' }]), isSidechain: true }) + '\n')
fs.writeFileSync(forkFile.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ isFork: true }))

test('a split reply counts once, with its final output', () => {
  const f = parseFile(coding)
  const split = f.reqs.filter((r) => r[1] === 'msg_split'.slice(-14))
  assert.equal(split.length, 1)
  assert.equal(split[0][7], 120)
})

test('each request knows what sent it', () => {
  const f = parseFile(coding)
  assert.deepEqual(f.reqs.map((r) => r[11]), [1, 2, 2, 1, 0, 1])
  assert.equal(f.reqs[1][12], 'Read')
  assert.equal(f.reqs[2][12], 'Edit')
})

test('after an edit the next request was avoidable; after a read it was not', () => {
  const f = parseFile(coding)
  assert.equal(f.reqs[1][13], 0, 'the read needed its result')
  assert.equal(f.reqs[2][13], 1, 'the edit only acted')
})

test('a "done" request: a result in, under 60 out, turn over', () => {
  const f = parseFile(coding)
  assert.deepEqual(f.reqs.map((r) => r[18]), [0, 0, 1, 0, 0, 0])
  // a real answer after a result isn't overhead, even when the turn ends
  const g = parseFile(write('s3.jsonl', [prompt('check'), asst(5000, [call('c1', 'Read', { file_path: 'a' })], { stop: 'tool_use' }), result('c1', 'text'), asst(6000, [{ type: 'text', text: 'It says...' }], { out: 90 })]))
  assert.deepEqual(g.reqs.map((r) => r[18]), [0, 0])
})

test('a big result rides along until the compaction, not after', () => {
  const f = parseFile(coding)
  assert.equal(f.riders.length, 1)
  const [tokens, rides, tool] = f.riders[0]
  assert.equal(tool, 'Read')
  assert.equal(tokens, 10000)
  assert.equal(rides, 4, 'the four requests between the result and the compaction')
})

test('the seam dries a finished turn when the next one starts, and pays a rewrite', () => {
  const f = parseFile(coding)
  assert.equal(f.reqs[2][15], 0, 'nothing dries inside its own turn')
  assert.ok(f.reqs[3][15] >= 9980, 'the read dries at the next prompt')
  assert.ok(f.reqs[3][16] > 0, 'and the cache after it is rewritten')
  assert.equal(f.reqs[3][17], 1, 'one dried result was a read')
  assert.equal(f.reqs[5][15], 0, 'a compaction starts the seam over')
})

test('Stop-hook beats: blocking ones go in twice, additionalContext once; sends count as acting for agents', () => {
  const f = parseFile(agent)
  assert.deepEqual(f.reqs.map((r) => r[11]), [1, 3, 2, 3, 3])
  assert.equal(f.beats[0], 3)
  assert.equal(f.beats[1], 2, 'only the two blocking beats were copied')
  assert.ok(f.beats[3] > 0, 'and the copies rode later requests')
  assert.equal(f.reqs[2][13], 0, 'coding: running a script is not acting')
  assert.equal(f.reqs[2][14], 1, 'agent: sending a message is')
  assert.equal(f.reqs[2][18], 1, 'and "sent" was pure overhead')
})

test('forks are told apart from other subagents', () => {
  const f = parseFile(forkFile)
  assert.equal(f.isAgent, true)
  assert.equal(f.isFork, true)
})

test('savings: facts add up, estimates print their parts, an agent session uses the agent classifier', () => {
  const files = [coding, agent, forkFile].map((x) => { const f = parseFile(x); return { f, rows: f.reqs } })
  const s = savings(files)
  assert.equal(s.n, 12)
  assert.equal(s.facts.done.n, 2)
  assert.equal(s.facts.forks.n, 1)
  assert.equal(s.facts.kinds.beats, 3)
  assert.equal(s.estimates.quill.removed, 2, 'the request after the edit, and the one after the send')
  assert.equal(s.estimates.quill.agentFiles, 1)
  assert.ok(s.estimates.seam.saved > 0 && s.estimates.seam.rewrite > 0)
  assert.equal(s.facts.prefix.sessions, 2)
  const c = compare(files, Math.floor(Date.parse('2026-10-20T10:00:40Z') / 1000), { project: 'shop' })
  assert.equal(c.before.requests + c.after.requests, 12)
  assert.equal(compare(files, 0, { project: 'nothing-here' }).after.requests, 0)
})

test('the share copy carries no names, titles or paths, and the check catches a leak', () => {
  const sums = [coding, agent].map(parseFile)
  sums[0].title = 'Fix the secret merger with Acme'
  const report = evaluate(sums, { now: Math.floor(T0 / 1000) + 3600 })
  const { report: R, secrets, titles } = anonymize(report)
  const md = shareMarkdown(R)
  const home = '/home/pat'
  assert.deepEqual(selfCheck(R, [md], { secrets, titles, home }), [])
  const text = JSON.stringify(R) + md
  assert.ok(!text.includes('Acme') && !text.includes('/home/pat') && !text.includes('"shop"'))
  // the check itself: a leaked title, path or project name is caught
  assert.ok(selfCheck({ x: 'Fix the secret merger with Acme' }, [], { secrets, titles, home }).length)
  assert.ok(selfCheck({ x: '/home/pat/shop/src/orders.ts' }, [], { secrets, titles, home }).length)
  assert.ok(selfCheck({ x: 'shop' }, [], { secrets, titles, home }).length)
  assert.ok(selfCheck({}, ['C:\\Users\\pat\\notes.txt'], { secrets, titles, home }).length)
})
