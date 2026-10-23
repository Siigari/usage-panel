# Where this is going

Today this is a meter: it shows where your Claude usage goes, request by request, and what would have saved it. This page is where it's headed. Nothing below ships until it can be measured.

## The problem

Every agent harness today is a chat window around a loop, and the loop is expensive in ways nobody can see:

- **Every action is a round trip.** The agent asks for a tool, waits for the result, and sends the whole conversation again to continue. On one always-on companion agent we measured, **two-thirds of requests existed only to hand a tool result back**, and a quarter of the bill was requests that said nothing but "done."
- **Sessions swell, and every message rereads all of it.** Over seven days of real coding sessions, **54% of the spend happened while a session was carrying more than 300K tokens of context.**
- **Agents forget** between sessions, and you babysit their tabs.

You can't fix what you can't see. So it starts with seeing.

## The path

Each step ships on its own and has to prove itself before the next one starts.

1. **The meter** (now). Free and local. It reads your Claude Code transcripts on your own machine and shows where the money went: context size, round trips, results that rode along for hundreds of requests, cold restarts, subagents. Then it estimates what a context cap, fewer round trips or drying old results would have saved, with the assumptions printed next to each number. Nothing leaves your computer.
2. **The Quill engine.** The agent writes short lines (say this, write that file, run this test) and they run after its reply, with no round trip per action and no tool list riding on every request. Work steps come back at once; anything that only speaks waits for the world. **It doesn't replace Claude Code, it hires it.**
3. **Memory** that recalls: an index, topics, a journal, and a nudge to write down what was learned, so an agent arrives knowing what it knew.
4. **A team:** roles, a board, review by someone who isn't the author. This is the expensive part to get right, which is why it comes fourth.
5. **The floor view:** who's working on what, what it's costing, and the one inbox that matters, "needs you."

## The numbers so far

| workload | what we have |
|---|---|
| an always-on companion agent | **about half** (43–56%) in a replay of its real transcript; the live before/after is being measured now |
| the same design running for weeks on another agent | $5.47/hour while carrying ~390K of context |
| coding | the engine alone: ~7% in a replay of 7 days of sessions; with old results dried, 13–22%; a context cap alone: 16–28% depending on where it's set. **Measured coding numbers are coming.** |

In short: **about half for agents that talk and act, measured in replay; coding numbers are coming.** We'll update this table as real before/after numbers land, including the ones that disappoint.

## What it isn't

- **Not another chat window**, and not a model.
- **Not a way around anyone's limits.** On a Claude subscription you get the meter and the engine's lines inside ordinary Claude Code: hooks and settings it supports, nothing patched or proxied. **Agents that run all day are for API keys**, not for burning a subscription plan.
- **Not a claim we can't show you on your own transcripts.**
