# Usage Panel

A Claude Code mod that opens a pane showing what your usage costs and where your plan's week is heading.

```
SPEND list $                PRESSURE                   TODAY'S MIX                FORECAST                   PLAN whole account
5m       $1.19 · 10 req     now          $14.33/h      reads     $76.52 · 72%     end of day     ~$149.47    5-hour     12%  ↻ 11:20 PM
30m      $8.68 · 74 req     1h pace      $12.15/h      writes    $12.97 · 12%     next 24h       ~$291.55    ━━━━━━━━━━━━━━━━━━━━━━━━━━━
1h     $12.15 · 103 req     req/h             103      input      $7.39 · 7%      context      479K / 1M     weekly     10%  ↻ Thu 11 AM
today $105.64 · 1077 req    cache hit        100%      output     $8.76 · 8%      full in         ~5.7 h     ━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                                                             forecast   full Sun 6 AM
■ reads  ■ writes  ■ input  ■ output  ─ context
[stacked bars: dollars per 5 minutes, with this session's context as a line]

THIS WEEK  grey = even pace · white = recorded · dashed = forecast · top = 100%
[the plan week from start to reset: even pace, what you've used, and where two paces land]
now 10%, 4 pts behind even pace
week pace → 18% at reset
3h pace → 140% at reset (full Sun 6 AM)
resets Thu 11 AM
```

## Install

You need Claude Code **2.1.287 or newer** (`claude --version`; `claude update` if older).

```
claude plugin marketplace add Siigari/usage-panel
claude plugin install usage-panel@siigari
```

Or from inside a session: `/plugin install usage-panel --marketplace Siigari/usage-panel`.

Restart Claude Code (or run `/reload-plugins`), then type **`/meter`** to open the pane. `/meter` again, or Esc, closes it.

## Where it shows

The pane draws in **`claude` in a terminal** (VS Code's built-in terminal counts) and in the **Code tab of the Claude Desktop app**. The VS Code extension's chat panel doesn't draw mods, but sessions there still record their usage, so the numbers stay complete.

In a wide terminal the pane sits beside the conversation; in a narrow one it sits above the prompt. Ctrl+X then an arrow key resizes it.

## What the numbers are

- **SPEND**: what the requests in that window would cost at API list prices, and how many there were. "today" starts at your local midnight.
- **PRESSURE**: "now" is the last 5 minutes scaled to an hour; "1h pace" is the last hour; "cache hit" is the share of prompt tokens served from the cache in the last hour.
- **TODAY'S MIX**: today's dollars split into cache reads, cache writes, fresh input, and output.
- **FORECAST**: today plus the last hour's pace until midnight, the next 24 hours at that pace, this session's context, and how long until it fills at the last hour's growth.
- **PLAN**: your account's 5-hour and weekly percent and when each resets, as Claude Code itself reads them. "forecast" is when the week runs out at the last 3 hours' pace (or the week's average pace before there are 3 hours of readings).
- **THIS WEEK**: grey is even pace (0% at the start of the week to 100% at reset), white is what you've actually used, and the dashed lines carry the week's average pace (amber) and the last 3 hours' pace (red) out to the reset. Lines stop where they cross 100%.

## Good to know

- **Dollars are list prices, not a bill.** On a Pro or Max plan you don't pay per token; the dollars are a way to compare. Cache writes are counted at the 1-hour rate (2x input), which is what Claude Code uses on a subscription. A model the price table doesn't know is priced like the rest of its family.
- **The plan percent is the whole account**, the same number `/usage` shows. It only appears on a subscription, after the first reply in a session.
- **Spend counts sessions on this computer** that have the plugin on, from when you installed it. Other computers and claude.ai chats count toward your plan percent but not toward the dollars.
- **Nothing leaves your machine.** The plugin keeps two days of requests and eight days of plan readings in Claude Code's plugin store (`~/.claude/plugins/store/`), and makes no network calls.

## Develop

```
claude --plugin-dir ./usage-panel        # load it from a checkout; edits reload on save
claude plugin validate --strict .        # what Claude Code reads from the hooks
claude plugin test                       # tests in tests/ (set SHOW = true in the test to print the charts)
```

Built and tested with Claude Code 2.1.295.
