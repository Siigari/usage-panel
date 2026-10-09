import { expect, mock, test } from 'claude-code/testing'
import { costOf, priceOf, summarize } from '../hooks/stats.js'

const H = 3600

test('prices follow the model family', async () => {
  expect(priceOf('claude-opus-5-5')).toEqual({ in: 4, out: 20, cr: 0.2, cw: 8, cw5: 5 })
  expect(priceOf('claude-sonnet-5')).toEqual({ in: 2, out: 10, cr: 0.2, cw: 4, cw5: 2.5 })
  expect(priceOf('claude-haiku-4-5-20251001').in).toBe(1)
  expect(priceOf('claude-fable-5-1').cr).toBe(0.25)
  // A million cache-read tokens on Opus 5 is fifty cents
  expect(costOf([0, 'claude-opus-5', 0, 1e6, 0, 0, 'x']).total).toBe(0.5)
})

test('summary adds up spend, mix, and the plan forecast', async () => {
  const now = 1_800_000_000
  const rows = [
    [now - 2 * H, 'claude-opus-5', 1000, 100000, 2000, 500, 'me'],
    [now - 600, 'claude-opus-5', 1000, 200000, 2000, 500, 'me'],
    [now - 60, 'claude-opus-5', 1000, 210000, 2000, 500, 'other'],
  ]
  const r7 = now + 3 * 24 * H
  const plan = [
    [now - 2 * H, 10, 40, now + H, r7],
    [now - 60, 12, 46, now + H, r7],
  ]
  const s = summarize(rows, plan, { now, mine: 'me', context: { tokens: 203000, window: 1000000 } })
  expect(s.spend.m5.n).toBe(1)
  expect(s.spend.h1.n).toBe(2)
  expect(s.pressure.cacheHit).toBeDefined()
  expect(Math.round(s.mix.total * 1000)).toBe(Math.round(rows.filter((r) => r[0] >= startOfToday(now)).reduce((a, r) => a + costOf(r).total, 0) * 1000))
  expect(s.plan.u7).toBe(46)
  // 6 points in 2 hours is 3 an hour; 54 points left is 18 hours, well before the reset
  expect(Math.round(s.plan.recentPace)).toBe(3)
  expect(Math.round((s.plan.fullAt - now) / H)).toBe(18)
})

function startOfToday(now: number) {
  const d = new Date(now * 1000)
  d.setHours(0, 0, 0, 0)
  return d.getTime() / 1000
}

const SHOW = false

const PANE = {
  plugin: 'usage-panel',
  component: 'Pane',
  requestId: 'usage-panel',
  viewport: { columns: 120, rows: 40 },
  props: { title: 'Usage', isFocused: false, bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('records a request and a plan reading, then draws both apps', async ($, on) => {
  const saved = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => { saved.set(e.key, e.value); return { value: undefined } })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('store.delete', ($, e) => { saved.delete(e.key); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: 'abcdef1234567890' }))
  const reset = new Date(Date.now() + 2 * 24 * H * 1000).toISOString()
  const limits = [
    { kind: 'five_hour', percentUsed: 12, resetsAt: new Date(Date.now() + 2 * H * 1000).toISOString() },
    { kind: 'seven_day', percentUsed: 61, resetsAt: reset },
  ]
  on('session.usage', () => ({ value: { context: { tokens: 300000, window: 1000000, percent: 30 }, rateLimits: limits, cost: { usd: 3 } } }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'ok' }
    return {
      turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn',
      usage: { model: 'claude-opus-5', input_tokens: 10, output_tokens: 800, cache_read_input_tokens: 250000, cache_creation_input_tokens: 4000 },
    }
  })
  mock.clock(on, { now: Date.now() })

  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  for (let i = 0; i < 3; i++) {
    const stream = $.turn.step({ turnId: 't', index: i, model: 'claude-opus-5', messageCount: 1 })
    let step = await stream.next()
    while (step.done !== true) step = await stream.next()
    expect(step.value.answer).toBe('ok')
  }
  await $.session.measure({ context: { tokens: 300000, window: 1000000 }, rateLimits: limits, changed: ['rateLimits'] })

  const reqKey = [...saved.keys()].find((k) => k.startsWith('req:'))
  expect(reqKey).toMatch(/^req:\d{4}-\d\d-\d\d:abcdef12$/)
  expect((saved.get(reqKey!) as unknown[]).length).toBe(3)
  expect([...saved.keys()].some((k) => k.startsWith('plan:'))).toBe(true)

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: 'SPEND' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: 'THIS WEEK' })).toBeDefined()
  const spend = await term.find({ key: 'spend' })
  const week = await term.find({ key: 'week' })
  expect(spend).toBeDefined()
  expect(week).toBeDefined()
  if (SHOW) { show(spend); show(week) }
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  expect(await desk.find({ type: 'Raster' })).toBeUndefined()
  await desk.unmount()
})

// Set SHOW to true to have the test print the two charts as the terminal would draw their characters
function show(el: any) {
  const { columns, rows, cells } = el.props
  const words = new Uint32Array(Uint8Array.from(atob(cells), (c) => c.charCodeAt(0)).buffer)
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < columns; c++) line += String.fromCodePoint(words[(r * columns + c) * 3])
    console.log(line)
  }
}
