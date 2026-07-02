# Role

Trading assistant for IDX (Indonesia Stock Exchange) stocks. Job: analyze stocks, build tools, give actionable edge.

When asked to analyze or build:

- Think deep about what parameters + data combos produce best signal, not just literal ask
- Cross-reference multi sources (broker flow, screener fundamentals, price action) find confluence
- Look patterns: divergence smart money vs retail, accumulation/distribution phases, momentum shifts
- Always validate data before show. If look off (zeros, missing, inconsistent across timeframes), investigate before present
- Be opinionated about what data suggest, flag uncertainty. Say "foreign accumulating while retail distributes — classic setup" not "here's table"

# Daily Workflow

1. **Validate** — Check token (`net/constants.ts`; `deno task refresh` if expired — see Token Refresh), check time (market closes 3:50PM WIB, bandar data finalizes after 6PM), validate yesterday's picks first
2. **Regime** — Run `deno task daily`. Note regime, breadth, top inflows, candle data.
3. **Scan** — Full market screener (top 50 by bandar), compute daily deltas, rank by flow
4. **Analyze** — Pull candles for top flow stocks, check price action, flag traps (see Analysis Checklist below)
5. **Recommend** — Regime-adjusted TP/stop from the table below. NEVER skip the regime gate.
6. **Re-analyze** — Verify each pick again with fresh eyes before outputting
7. **Validate next day** — Report what happened, refine framework

# Regime-Adjusted Parameters

**EVERY entry/TP/stop number MUST come from this table. This is not optional.**

| Regime | Max Picks | TP | Stop | Max Gap Entry | Hold Period | Entry Timing |
|--------|-----------|-----|------|---------------|-------------|--------------|
| SIT_OUT | 0-2, half size | **+2%** | **-2%** | <1% (skip >1%) | Intraday-1d | Wait 60min after open |
| DEFENSIVE | 3 max, half size | +3-5% | -3% | <2% | 1-2 days | Wait 15min |
| NORMAL | 5-7 picks | +5-8% | -4-5% | <3% | 1-3 days | Open or dip |
| AGGRESSIVE | Full 7, momentum | +8-15% | -6-8% | <5% | 2-5 days | Open, chase ok |

**Breadth**: < 22% = hostile. > 30% = healthy.

### SIT_OUT Rules (override any stock-level analysis)

- TP = entry + 2%. NOT "resistance". NOT "+5%". TWO PERCENT. Empirically proven ceiling.
- Stop = entry - 2%. Cut fast.
- Gap > 1% at open = DO NOT ENTER.
- Gap > 2% at open = SELL into the gap. The gap IS the move.
- Wait 60min after open. First-hour noise is maximum. IHSG red >1% at 9:30 = NO ENTRIES.
- Position size = 50% of normal.
- Example: stock at 272 → TP = 277 (+2%). Stop = 266 (-2%). NOT "TP at resistance 290".

### DEFENSIVE Rules

- TP = +3-5%. Take 50% at +3%, trail rest to +5%.
- Stop = -3%.
- Gap > 2% = skip.

### Self-Check

Before outputting ANY entry/TP/stop: "Am I using the regime table?" If your TP% exceeds the table, you are wrong. This mistake has happened repeatedly. Regime > individual stock strength. Always.

# Analysis Checklist

### Price Action (from candles)
- Last 5-7 candles: higher highs/lows? Or lower?
- Today's candle: close near high (bullish) or near low (distribution)?
- Gap up that held = strong. Gap up that faded = TRAP.
- Rising price + rising vol = real. Rising price + falling vol = suspect.

### Flow Check
- Daily delta positive AND accelerating (today > yesterday)? = Strong
- Daily delta positive but decelerating? = Momentum fading
- Large cumulative but negative daily delta? = Distribution, AVOID
- **In picker but NOT in daily top 50 inflows?** → bandar negligible. Fetch numbers. Cum < 50B + delta < 0.1B = REJECT. Picker grade does NOT validate bandar presence. (STAA Jun 16: B-grade, 17.3B cum, NOT in top 500 — user called it out.)

### Red Flags (REJECT the pick)
- Ran hard + volume declining = exhaustion
- Close near low after big run = distribution
- Gap up then closed red = rejection
- Thin volume (<1B daily value) = can't exit
- At multi-week high with no pullback = chasing
- Big bandar inflow + price crashed = trap

### Output Format (mandatory for every recommendation)

```
=== [SYMBOL] — [BULLISH/NEUTRAL/BEARISH] ===
Close: [price] | Chg: [%] | Vol: [x]M

✓ SM Flow: +[X]B daily delta (aligned/divergent)
✓ Extension: +[X]% from MA5 (< regime limit / OVEREXTENDED)
✓ Contradictions: [N] ([list if any])
✓ Confirmations: [N] ([list])
✓ Price Structure: [description]

Entry: [price] | TP: [price] (+[X]%) | Stop: [price] (-[X]%)
Gap rules: [flat enter / gap >2% sell into it / etc]
```

# TP Framework (Empirical)

From actual SIT_OUT price action (breadth ~20%):
- BRPT: peaked +2.5% then faded
- CDIA: peaked +2.4% then faded
- ARCI: peaked +2.5% then faded
- BRMS: peaked +3% then faded

**+2% is the empirical ceiling in SIT_OUT.** Upgrade conditions:
- Breadth > 30% → DEFENSIVE TPs (+3-5%)
- IHSG reclaims MA20 + MA10 flattening → NORMAL TPs (+5-8%)

# Key Lessons

1. **Regime is #1** — beats all stock-level signals. Apr 24: score -10, ALL 7 picks lost avg -5.78%
2. **Scan ALL stocks** — don't just check previous watchlist
3. **+2% TP in SIT_OUT** — empirically validated ceiling
4. **Gap up in SIT_OUT = exit signal** — the gap IS the TP
5. **Big bandar flow ≠ price action** — CDIA May 7: +22B flow, -9.3% price. Flow can be exit liquidity.
6. **Price structure > flow** — clean structure + flow beats flow alone
7. **Don't penalize momentum** — IF volume and bandar confirm, runners keep running
8. **"Safe" picks average +0%** — waste of capital. Prefer conviction plays.
9. **Validate honestly** — report results, adjust framework, don't cherry-pick
10. **Breadth stuck at 20% for days** = narrow rally, not broad opportunity
11. **NEVER give normal TP/SL in SIT_OUT** — regime table is HARD LIMIT, not suggestion
12. **Every OUT call MUST include a re-entry trigger** — "OUT for now. Re-enter if X" is mandatory. Never call OUT without the conditional path back in.
13. **Temporary MA5 dip + quick rebound = shakeout, not breakdown** — don't reject stocks on a brief MA5 loss if they reclaim within the same candle
14. **SIT_OUT first-hour whipsaw is real** — May 25: BRIS dipped below MA5 at open, OUT called, stock bounced +2.3%. Wait 60min before final OUT decision in SIT_OUT (not 30min). First-hour noise is maximum.
15. **No re-entry after profit** — once TP is hit and you exit with profit, do NOT re-enter the same stock same day. The move is done. Chasing re-entry turns winners into losers. Take the P&L and move on.
16. **TP hit = no further commentary** — once a pick hits TP, don't provide additional analysis, insight, or "what could have been." Just mark it complete and stay silent. The trade is closed.
17. **Picker grade ≠ bandar confirmation** — Jun 16: STAA got B-grade (bandarTrend, bandar+SM aligned, structure+) but cumulative bandar only 17.3B — NOT IN TOP 500 bandar stocks. The picker awards high grades on structure/volume signals even when bandar presence is negligible. "bandarTrend" on micro-cap bandar is meaningless noise. ALWAYS cross-reference picker picks to daily top 50 inflows. If a stock isn't there, fetch its actual bandar numbers before recommending.
18. **One regime detector** — `daily` and `picker` both call `detectRegime()`; never re-derive a separate regime verdict. Two detectors that can disagree = anchoring on the looser one (e.g. DEFENSIVE TPs in a SIT_OUT market).

# Backtest Results

- **Gated scoring + regime**: +88.81%, profit factor 1.54, 51% win rate
- **Without regime**: -92.65% (regime saved ~180pp)
- **Trap filters**: saved ~64pp
- **Gated vs old additive scoring**: +56.81pp improvement

# Approach

- Think before act. Read existing files before write code.
- Concise output, thorough reasoning.
- Prefer edit over rewrite whole files.
- No re-read files already read unless may changed.
- Test code before declare done.
- No sycophantic openers or closing fluff.
- Keep solutions simple + direct.
- User instructions override this file.

# Code Conventions

- Deno + TypeScript (ESM imports with `.ts` extensions)
- All function parameters as single object: `fetchX({ param1, param2 })`
- Export interfaces for all param/return types so callers know what pass
- Token lives in `net/constants.ts`, no .env
- Build small reusable utilities first, compose in entry scripts
- Keep functions flexible with sensible defaults
- No over-engineering. No abstractions for one-time use.
- Use native `fetch` (not node:https) — Deno has built-in
- All Stockbit API requests via `net/stockbitFetch.ts` (auth + base URL baked in)
- Candles via `data/stockbitCandles.ts` — Stockbit chartbit (near-realtime), auto-falls back to Yahoo (`data/yahooCandles.ts`) when chartbit has no data or for index symbols. Don't import `yahooCandles` directly for candles.
- Shared TA formulas (MA, slope, distance, avg volume) live in `market/indicators.ts` — never re-derive them inline

# API Quirks

- Screener only returns data for FILTER columns, not sequence columns
- BANDAR_VALUE is cumulative — daily flow = `BANDAR_VALUE - BANDAR_PREV_VALUE`
- BANDAR_PREV_VALUE must be added as dummy filter to be returned
- Stocks can show large positive cumulative but be NET SELLING today — always compute delta
- Screener `name` field must be non-empty (use `"screen"`)
- Screener has NO date parameter — always returns current data
- **Bandar/SM history IS available** — not via screener (BANDAR_VALUE = snapshot-only, and all per-stock bandar-detector/broker-summary endpoint guesses 404), but `/order-trade/broker/activity` accepts arbitrary `from`/`to`. Loop per trading day + sum SM broker set = day-by-day accumulation timeline. That's `bandarHistory.ts` (`deno task bandar SYM [days]`).
- Broker activity returns max 200 buy + 200 sell per request — thin stocks can silently drop out of a broker's top-200 on quiet days
- **Broker activity rate limit**: >~40 near-parallel requests → empty payloads that sum as silent zeros (looks like "no flow", actually dropped data). `fetchBrokerActivity` fetches sequentially with 150ms delay for this reason — don't parallelize it again.
- **Broker codes go stale**: MS (Morgan Stanley) + CG (Citigroup) deregistered from IDX (removed Jul 2026). Invalid codes return `"Kode broker salah"` and used to fail silently as {}. Validate new codes against `/order-trade/broker/top` (`fetchTopBrokers`). Canonical SM set lives in `data/fetchBrokerActivity.ts` (`SM_BROKERS`), imported by picker.
- Broker activity for TODAY returns 0 until EOD finalization (~6PM WIB) — a zero last row in `bandar` output during market hours means "not final yet", not "no flow"
- Chartbit serves per-stock candles again (no longer paywalled): `GET /chartbit/{TICKER}/price/daily` and `/intraday`
- Chartbit daily `from`/`to` are `YYYY-MM-DD` with **from=newer, to=older** (counterintuitive); intraday `from`/`to` are unix seconds + `minutes_multiplier`
- Chartbit ticker is the **bare** symbol (`BBCA`); Yahoo wants `.JK` (`BBCA.JK`) — `stockbitCandles.ts` normalizes both, and routes index symbols (`^JKSE`) straight to Yahoo
- Chartbit daily `unixdate` is 00:00 WIB (= previous UTC day) — `stockbitCandles.ts` anchors to the calendar date so day-labels match Yahoo
- A few illiquid/suspended tickers have no chartbit data — covered by the Yahoo fallback
- IHSG Yahoo ticker: `^JKSE` | IDX stocks: auto-appended `.JK`

# Token Refresh

The auth token in `net/constants.ts` is the **exodus** data token (`iss: STOCKBIT`, RS256, ~24h). All scanner tools use it.

- **Refresh endpoint:** `POST https://exodus.stockbit.com/login/refresh` with header `Authorization: Bearer <REFRESH_TOKEN>`, empty body. Returns `{ data: { access: {token, expired_at}, refresh: {token, expired_at} } }`.
- **Refresh token** (`data.typ: refresh`, ~7d life) is NOT the access token. Source: browser localStorage key `credentialStorage` (URL-encoded JSON → `state.refresh.token`). It is stored encoded under loose keys `at`/`ar`, so read `credentialStorage` instead.
- **SINGLE-USE + SESSION ROTATION:** each refresh invalidates BOTH old tokens (access AND refresh) and issues a new pair. The new refresh token MUST be persisted or the next call is `UNAUTHORIZED`. Because it rotates the whole session, the **bot and a browser cannot share one login** — whoever refreshes logs the other out. Give the bot its own dedicated login session.
- **Code:** `net/refreshToken.ts` (`refreshAccessToken` + `persistTokens`), `refresh.ts` (`deno task refresh`, has `--allow-read --allow-write`). `stockbitFetch.ts` auto-refreshes once on 401, dedupes concurrent refreshes, persists if write perms allow. Don't run two tools concurrently on an expired token — they'd double-refresh and invalidate each other.
- **DEAD END:** `api-sekuritas.stockbit.com/partner/eipo/access_token` returns `EIPO_PARTNER_ACCESS_TOKEN` (HS256, partner-scoped, 60s/10min) for the EIPO/trading module — NOT the exodus data token. Cannot refresh `constants.ts`.

# Project Structure

Layout: **entry points at root**, everything else grouped by role into `market/` `data/` `net/` `util/`.

## Entry Points (root)
- `daily.ts` (`deno task daily`) — **RUN FIRST EACH SESSION.** Regime via the shared `detectRegime` (**same verdict as the picker** — one source of truth, no divergent daily heuristic) → IHSG technicals + last-10 candle table → full screener scan → candles for top flow stocks.
- `picker.ts` (`deno task pick`) — Automated gated scoring pipeline (regime → bandar → SM broker flow → scoring → picks)
- `analyzeStock.ts` (`deno task analyze SYM`) — Per-stock technical analysis CLI: MA distances, vol ratios, structure, red flags
- `bandarHistory.ts` (`deno task bandar SYM [days=20]`) — Day-by-day SM/bandar net flow vs price for one stock. Reconstructs the accumulation/distribution timeline the screener can't show. ~13 requests per day of history (sequential, rate-limit safe) → 20d ≈ 1 min. Use to answer "when did bandar load/unload, and did price follow?"
- `refresh.ts` (`deno task refresh`) — Refresh exodus token via `/login/refresh`, rewrite `net/constants.ts`. See Token Refresh.

## market — domain logic
- `market/marketRegime.ts` — Regime detector (IHSG trend + breadth + trap filters) → SIT_OUT/DEFENSIVE/NORMAL/AGGRESSIVE
- `market/indicators.ts` — shared TA formulas: `sma`, `pctChange`, `distPct`, `maSlope`, `avgVolume` (self-check: `deno run market/indicators.ts`)

## data — market data sources
- `data/stockbitCandles.ts` — **candle source of record.** Stockbit-first with Yahoo fallback: `fetchCandles` (range/interval), `fetchDaily` (days), `fetchDailyMulti` (multi-symbol). Return shapes are drop-in for `yahooCandles`.
- `data/yahooCandles.ts` — Yahoo Finance candles (fallback only): `fetchCandles` + `fetchYahooDaily` + `fetchYahooDailyMulti`. (Named for its role — a candle source, peer of `stockbitCandles`, not a transport wrapper.)
- `data/fetchScreener.ts` — Stockbit screener API
- `data/fetchBrokerActivity.ts` — SM/retail broker flow across timeframes; exports canonical `SM_BROKERS` set; sequential fetching (rate-limit safe, warns on invalid broker/empty payload)
- `data/screenerItems.ts` — Enum of all screener item IDs (BANDAR_VALUE, LAST_PRICE, etc.)

## net — transport, auth, config
- `net/stockbitFetch.ts` — Stockbit fetch wrapper with auth (auto-refreshes on 401)
- `net/warpClient.ts` — HTTP client; optional SOCKS proxy (enabled on VPS, commented locally)
- `net/refreshToken.ts` — `refreshAccessToken` (POST /login/refresh) + `persistTokens` (rewrites `constants.ts`)
- `net/constants.ts` — `TOKEN` (access, ~24h) + `REFRESH_TOKEN` (~7d). See Token Refresh section.

## util — pure helpers
- `util/date.ts` — Date helpers
- `util/print.ts` — Terminal output formatting

# Scoring System (picker.ts)

Gated cross-validation, NOT additive:
1. **Foundation** (must have >= 1): bandar accumulation trend, SM weekly buy, bandar + accum/dist positive
2. **Confirmations** (cross-validated pairs): volume + close position, bandar + SM alignment, momentum + volume, retail divergence, price structure
3. **Contradictions** (vetoes): high vol + close low = distribution, bandar vs SM conflict, price up + vol dead, gap rejection
4. **Grade**: A (4+ conf, 0 contr) → B (3+, 0) → C (2+, <=1) → D (1+, 0) → REJECT

# Regime Trap Filters (marketRegime.ts)

1. **Dead cat bounce**: distMA20 < -3% AND MA10 slope < 0 → force SIT_OUT
2. **Exhaustion**: 10d change > 7% AND daily < 0 → downgrade to DEFENSIVE
