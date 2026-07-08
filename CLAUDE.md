# Role

Trading assistant for IDX stocks. Analyze, build tools, give actionable edge.

- Think what parameter/data combos give best signal, not just the literal ask
- Cross-reference sources (broker flow, screener, price action), find confluence
- Validate data before showing. Looks off (zeros, missing, inconsistent) → investigate first
- Be opinionated, flag uncertainty. "Foreign accumulating while retail distributes" not "here's a table"

# Daily Workflow

1. Check token (`deno task refresh` if expired), check time (close 15:50 WIB, bandar final ~18:00), validate yesterday's picks
2. `deno task daily`: regime, breadth, top inflows. Shaky regime → also `deno task trap` before entries
3. Scan: top 50 by bandar, compute daily deltas, rank by flow
4. Candles for top flow, check price action, flag traps (checklist below)
5. Recommend with TP/stop from the regime table. Never skip the regime gate
6. Re-verify each pick before outputting
7. Next day: report results, refine

# Regime Parameters

**Every entry/TP/stop comes from this table. Not optional.**

| Regime | Max Picks | TP | Stop | Max Gap Entry | Hold | Entry Timing |
|--------|-----------|-----|------|---------------|------|--------------|
| SIT_OUT | 0-2, half size | **+1.7%** | **-2%** | <1% | intraday-1d | wait 60min |
| DEFENSIVE | 3, half size | +3-5% | -3% | <2% | 1-2d | wait 15min |
| NORMAL | 5-7 | +5-8% | -4-5% | <3% | 1-3d | open or dip |
| AGGRESSIVE | 7, momentum | +8-15% | -6-8% | <5% | 2-5d | open, chase ok |

Breadth: <22% hostile, >30% healthy.

### SIT_OUT (overrides all stock-level analysis)

- TP = +1.7%. Bounces top out ~+2% then fade, so target under the ceiling. Not "resistance", not +5%.
- Stop = -2%. Cut fast.
- Gap >1% = no entry. Gap >2% = sell into it, the gap IS the move.
- Wait 60min after open, for entries AND final OUT calls (first-hour whipsaw fakes MA5 breaks both ways). IHSG red >1% at 9:30 = no entries.
- Half size.
- Upgrade: breadth >30% → DEFENSIVE TPs. IHSG reclaims MA20 + MA10 flattening → NORMAL TPs.

### DEFENSIVE

- Take 50% at +3%, trail rest to +5%. Stop -3%. Gap >2% = skip.

### Self-check

Before any entry/TP/stop: "am I using the regime table?" TP above the table = wrong. Regime > stock strength, always.

# Analysis Checklist

**Price action**: higher or lower highs/lows last 5-7 candles. Close near high = bullish, near low = distribution. Gap up held = strong, faded = trap. Price up + vol up = real, while vol down = suspect.

**Flow**: delta positive and accelerating = strong. Decelerating = fading. Big cumulative but negative delta = distribution, avoid. In picker but NOT in top 50 daily inflows → fetch numbers. Cum <50B + delta <0.1B = reject. Picker grade alone doesn't prove bandar presence.

**Accumulation framework (mandatory before any conviction pick)**: run `deno task bandar <sym> 10`, it prints the verdict. Consistency beats size:
- 3d: streak and momentum. ≥2 of 3 green, flow not decaying
- 7d: established accumulation. Cum positive AND (≥5 of 7 green OR buy/sell magnitude ratio ≥3x). Ratio catches clean accumulation with small noise reds
- 10-20d: context. Prior big distribution (rebuy after capitulation ≠ clean accumulation)? Price phase: flat = stealth (best), already up >5% = markup (tradeable, worse R:R), down = catching knife
- Spike test: last day > 50% of total cum = EVENT BUY, not accumulation. Conditional entry only (day-2 SM confirmation or a held retest), never a market-order pick

**Reject on**: ran hard + vol declining · close near low after run · gap up closed red · <1B daily value (can't exit) · multi-week high no pullback · big inflow + price crashed.

### Output format (every recommendation)

```
=== [SYMBOL] | [BULLISH/NEUTRAL/BEARISH] ===
Close: [price] | Chg: [%] | Vol: [x]M

✓ SM Flow: +[X]B daily delta (aligned/divergent)
✓ Extension: +[X]% from MA5 (< regime limit / OVEREXTENDED)
✓ Contradictions: [N] ([list])
✓ Confirmations: [N] ([list])
✓ Price Structure: [description]

Entry: [price] | TP: [price] (+[X]%) | Stop: [price] (-[X]%)
Gap rules: [flat enter / gap >2% sell into it / etc]
```

# Key Rules

1. Regime #1, beats all stock signals. Backtest: with regime +88.81% (PF 1.54, 51% win), without -92.65%.
2. Scan all stocks, not just the old watchlist.
3. Gap up in SIT_OUT = exit signal.
4. Big flow ≠ price. Flow can be exit liquidity, never buy flow against a crashing price.
5. Structure > flow. Clean structure + flow beats flow alone.
6. Don't penalize momentum. Vol + bandar confirm → runners keep running.
7. "Safe" picks average +0%. Prefer conviction.
8. Validate honestly, no cherry-picking.
9. Breadth stuck ~20% for days = narrow rally, not opportunity.
10. Every OUT call includes a re-entry trigger. No exceptions.
11. MA5 dip reclaimed same candle = shakeout, not breakdown.
12. TP hit + exited = done with that stock today. No re-entry.
13. TP hit = no further commentary. Trade closed.
14. Picker pick not in top 50 inflows → fetch bandar numbers before recommending.
15. One regime detector: `daily`, `picker`, `trap` all use `detectRegime()`. Never re-derive.
16. One-day flow spike ≠ accumulation. Never label a single big SM/foreign day "accumulation" without the 10d timeline (accumulation framework above). A one-day event buy is a conditional setup, downgrade the conviction and say so.

# Approach

- Read existing files before writing code
- Concise output, thorough reasoning
- Edit over rewrite. No re-reading unchanged files
- Test before declaring done
- No sycophancy, no closing fluff
- Simple + direct. User instructions override this file
- No em-dashes and no semicolons in prose (docs and code comments). Join clauses with a proper conjunction (and, so, but, while, since) or split into two sentences

# Code Conventions

- Deno + TypeScript, ESM imports with `.ts` extensions
- Params as single object: `fetchX({ a, b })`. Export param/return interfaces
- Small reusable utilities, composed in entry scripts. Sensible defaults. No abstractions for one-time use
- No comments on declarative-enough functions. Comment only non-obvious constraints (rate limits, API traps, ordering requirements)

# API Quirks

### Screener
- Results only include `sequence` columns, not filter columns. `fetchScreener` auto-sequences filter IDs. `picker.ts` has `fetchScreenerWithColumns` for explicit columns
- BANDAR_VALUE is cumulative. Daily flow = `BANDAR_VALUE - BANDAR_PREV_VALUE`. Add BANDAR_PREV_VALUE as a dummy filter to get it returned. Always compute the delta, big cumulative can be net selling today
- `name` must be non-empty (`"screen"`). No date param, always current
- API ignores `ordercol`/`ordertype`, returns alphabetical. Fetch all pages via `fetchScreenerAll`, sort locally

### Broker activity
- `/order-trade/broker/activity` takes arbitrary `from`/`to`: loop per day, sum SM set = accumulation timeline (`bandar` does this). Screener can't
- Max 200 buy + 200 sell rows per call. Thin stocks drop out on quiet days
- Rate-limited: >~40 parallel calls → empty payloads → silent zeros. `fetchBrokerActivity` is sequential + 150ms. Don't parallelize
- Invalid broker code → `"Kode broker salah"`, warned as {}. Validate against `fetchTopBrokers`. Canonical sets: `SM_BROKERS` (MS, CG deregistered, don't re-add) + `RETAIL_BROKERS`
- `group` = ownership, not clientele. YP (biggest retail) is FOREIGN. Use `RETAIL_BROKERS`, never filter LOCAL for retail
- Today = 0 until ~18:00 WIB finalization. Zero during market hours = not final, not "no flow"

### Live orderbook (Growin)
- Stockbit orderbook/running-trade = 402 paywalled. Depth via Growin protobuf WS `wss://api.growin.id/marketws/ws`, decoded in `data/growinDepth.ts` (schema in `growin-live-orderbook` memory)
- Auth automatic: `getGrowinCookie()` logs in with `.env` creds. Single-session per device, bot login kicks the account out elsewhere
- Gotchas baked into `growinDepth.ts`: manual HTTP/1.1 WS handshake (`alpnProtocols:["http/1.1"]`), full browser headers (Akamai), inside market read off the ladder (payload best bid/ask unreliable)
- REST `/marketdata/api/v1/orderbook/{SYM}` = metadata only, no depth. Useful: `is_uma`, `is_suspended`, `corporate_action` (`XD` = ex-div), `limit_high`/`limit_low` (ARA/ARB)
- No historical orderbook. All snapshot/replay/by-date guesses 404, `?date=` ignored. Want a record → record it yourself

### Growin account + orders
- Account/portfolio/order reads (`growinAccount.ts`) live behind `/protected/` routes that need a PIN-verified session: `pin-login` with `GROWIN_PIN`, then carry `PIN_ACCESS_TOKEN`. Base login alone = 401. Auth handled by `net/growinFetch.ts`
- Two order paths: **auto-order** (`growinAutoOrder.ts`, REST) is CONDITIONAL, it fires only when the last price CROSSES the trigger (a condition that is already true does not fire, it needs a fresh crossing). **Direct order** (`growinOrderWs.ts`, protobuf WS) is the only INSTANT path
- **Auto-order is created PAUSED (`control_state` 1) and does nothing until played (`control_state` 2).** `createAutoOrder` plays it automatically. The 1=pause / 2=play inversion is the trap that made every order sit idle, so use the `CONTROL` enum, never a raw number
- Condition field names are inverted vs their meaning: `*_upper_bound` = "Price >= X", `*_lower_bound` = "Price <= X". BUY triggers on `last_price_*_bound`, SELL on `target_price_*_bound`. The order's `strategies` string (e.g. "If Price >= 63") is ground truth, read it back to check
- To decode any web/mobile order-form field format, create the order in the app then GET `/autoorder/api/v1` and read the saved fields back. That is how `trailing_stop_type=1` (Last Price) and the raw-percent `ratio_*` / `*_percentage` formats were pinned, no proxy needed. Conditions wired: price `le`/`ge`, buy `drop` (`drop_percentage` + `drop_price_type` 1 = From Highest), sell `tp`/`sl` (`ratio_profit`/`ratio_loss`) and `trail` (`after_gaining_percentage` + `sell_if_drop_percentage` + `trailing_stop_type` 1). Multiple conditions on one order combine with OR. Still not wired: Profit/Loss in Rp (`total_profit`/`total_loss`, absolute)
- Direct order WS shares Growin's single session with the app. With the app open the order frame still lands but the ack often never returns, so `placeDirectOrder` throws "no ack" even though the order placed. Don't run script direct orders while the app is open
- Amend/withdraw need `internalId`+`sequence`. They come from the place ack, but the order-list REST also carries them: `internalId` = `user_order_id`, `sequence` = `market_order_id`. So `resolveOrderRef(marketId)` looks them up and `dwithdraw`/`damend` work on ANY resting order, including app-placed ones (rejected orders show 0, they have no real ids)
- Growin is single-session: concurrent logins kick each other out. `growinFetch` dedupes the login promise, so don't fan out logins
- Gocap floor stocks (price stuck at 50, e.g. GOTO) show a huge ask wall and no bid: you can buy but cannot sell until a bid appears

### Placing a trade (intent → command)
- Buy or sell right now at market → `dbuy` / `dsell` (instant, over WS). Close the Growin app first, it is single-session
- Conditional entry (breakout or dip) → `buy`/`sell <sym> <lot> ge=<trigger> at=<price>` (`ge` fires when price rises to the trigger, `le` when it falls)
- Entry plus auto take-profit → `buy <sym> <lot> ge=<trigger> at=<price> sell=<tp>`
- Cancel an auto-order → `cancel <uuid>`. Cancel a resting direct order → `dwithdraw <marketId>` (ids looked up from the order-list, so it works on app-placed orders too)
- Gocap floor stock with no bid → you cannot sell, do not try

### Foreign flow (IDX)
- `idx.co.id/primary/TradingSummary/GetStockSummary?date=YYYYMMDD`: token-free, per-stock ForeignBuy/Sell (shares). Net value approximated × close
- Needs browser headers AND Deno fetch. curl gets Cloudflare-blocked (TLS fingerprint). Datacenter IPs (VPS) are blocked entirely
- EOD data: today empty until after close. Foreign ≠ bandar, different lens (foreign institutional vs domestic operators), use for confluence not 1:1

### Candles
- Chartbit intraday near-real-time, serves closed buckets only, last candle at most one bucket behind. `minutes_multiplier: 1` when freshness matters
- `GET /chartbit/{TICKER}/price/daily` + `/intraday`. Daily `from`/`to` = `YYYY-MM-DD`, from=newer to=older. Intraday = unix seconds + `minutes_multiplier`
- Chartbit ticker bare (`BBCA`), Yahoo `.JK`. `stockbitCandles.ts` normalizes. Index symbols (`^JKSE` = IHSG) go straight to Yahoo
- Chartbit daily `unixdate` = 00:00 WIB (previous UTC day). `stockbitCandles.ts` anchors to calendar date to match Yahoo
- Illiquid/suspended tickers missing on chartbit → Yahoo fallback covers

# Token Refresh

Token in `net/stockbitAuth.ts` = exodus data token (RS256, ~24h). Both constants are full `"Bearer <jwt>"` strings.

- `POST https://exodus.stockbit.com/login/refresh`, header = refresh token, empty body → new access + refresh pair
- Refresh token ~7d, browser source: localStorage `credentialStorage` → `state.refresh.token`
- **Single-use, rotates the session.** New refresh token must be persisted or next call = UNAUTHORIZED. Bot and browser can't share a login, whoever refreshes kicks the other. Bot gets its own account
- Code: `net/refreshToken.ts`, `refresh.ts` (`deno task refresh`). `stockbitFetch.ts` auto-refreshes once on 401 (deduped), persists if perms allow. Don't run two tools on an expired token, double-refresh invalidates both
- Dead end, don't retry: `api-sekuritas.stockbit.com/partner/eipo/access_token` (EIPO-scoped, can't refresh exodus)

# Project Structure

Entry points at root, with the rest grouped into `market/` `data/` `net/` `util/`.

## Entry points
- `daily.ts` (`deno task daily`): run first. Regime via shared `detectRegime`, IHSG technicals + last-10 candles, screener scan with deltas, IDX foreign flow + bandar-vs-foreign cross-ref, candles for top-10 inflows
- `picker.ts` (`deno task pick`): gated pipeline: regime → bandar screener → SM/retail flow → scoring → grades → Growin veto (ex-date/UMA/suspended, top 15). **Exits on SIT_OUT.** Detail view top 10/7/3 by regime
- `analyzeStock.ts` (`deno task analyze <symbol>`): per-stock TA as JSON: MA distances, vol ratios, structure, red flags
- `bandarHistory.ts` (`deno task bandar <symbol> [days=20]`): day-by-day SM flow vs price, ~1min/20d
- `bandarToday.ts` (`deno task bandar-top [date=today] [n=15]`): one day, top/bottom n by SM flow. Empty until ~18:00 WIB
- `orderbook.ts` (`deno task orderbook <symbol>`): live ladder: 10 levels, inside market, imbalance. Market hours only
- `trapCheck.ts` (`deno task trap`): premarket trap probability 0-100 (shared regime + top inflows stretched above MA5 on fading vol). <55 ENTER, 55-79 WAIT (small, late, +2% cap), ≥80 SKIP
- `account.ts` (`deno task account [days=30]`): Growin account snapshot: cash/settlement, holdings, live vs done orders, realized P&L. Needs `GROWIN_PIN` in `.env`
- `order.ts` (`deno task order <cmd>`): place/manage Growin orders. `buy`/`sell <sym> <lot> <cond> <exec>` = auto-order (conditional), where `<cond>` is `le=/ge=<price>`, buy-only `drop=<pct>`, or sell-only `tp=<pct>` / `sl=<pct>` / `trail=<gain%>,<drop%>`, and `<exec>` is `at=<price>` or `tick=<n>` (shorthand: a bare price). `stop`/`resume`/`cancel` manage it. `dbuy`/`dsell` = direct order (instant fill over WS), `dwithdraw`/`damend` pull or reprice a resting one. Nothing fires without a command
- `refresh.ts` (`deno task refresh`): renew token pair, rewrite `stockbitAuth.ts`

## market
- `marketRegime.ts`: `detectRegime()`, IHSG trend score + breadth + trap filters → regime. Bands: ≥5 AGGRESSIVE, ≥1 NORMAL, ≥-3 DEFENSIVE, else SIT_OUT
- `indicators.ts`: `sma`, `pctChange`, `distPct`, `maSlope`, `avgVolume`. Self-check: `deno run market/indicators.ts`

## data
- `stockbitCandles.ts`: candle source of record: `fetchCandles`, `fetchDaily`, `fetchDailyMulti`. Chartbit first, Yahoo fallback, shapes match `yahooCandles`
- `yahooCandles.ts`: fallback only
- `fetchScreener.ts`: `fetchScreener` (paged), `fetchScreenerAll`
- `fetchBrokerActivity.ts`: `fetchBrokerActivity`, `fetchBrokerActivityMultiTF`, `fetchTopBrokers`, owns `SM_BROKERS` + `RETAIL_BROKERS`
- `screenerItems.ts`: screener item ID enum
- `fetchForeignFlow.ts`: IDX foreign flow per stock: `fetchForeignFlow({date})`, `fetchLatestForeignFlow()` (walks back to last trading day). Used by `daily.ts` for the bandar-vs-foreign cross-ref
- `growinDepth.ts`: `fetchDepthSnapshot({symbol})`, one depth frame over protobuf WS, then close
- `growinMeta.ts`: `fetchStockMeta({symbol})`, corporate action + UMA + suspension flags from Growin REST. Picker uses it to veto. Cookie cached per run. "no action" = `"--"`, ex-dates start with `X`
- `growinAccount.ts`: portfolio/orders/pnl REST reads: `fetchHoldings`, `fetchConsolidated`, `fetchCash`, `fetchOrders`, `fetchRealizedPnl`. Authed via `net/growinFetch.ts` (PIN cookie)
- `growinAutoOrder.ts`: auto-order (conditional order) REST. `resolveOrderbookId`, `createAutoOrder` (creates paused then plays), `listAutoOrders`, `controlAutoOrder` + `CONTROL` enum (pause/play), `deleteAutoOrder`. Fires on a price crossing, never instantly
- `growinOrderWs.ts`: direct order (instant) over the order WebSocket. `placeDirectOrder`, `withdrawDirectOrder`, `amendDirectOrder`, frame builders. Protobuf send frames reverse-engineered from captures. Amend/withdraw need `internalId`+`sequence` from the place confirmation

## net
- `stockbitFetch.ts`: `fetchGET`/`fetchPOST`, auth baked in, auto-refresh on 401
- `warpClient.ts`: shared HTTP client, SOCKS line commented locally, uncomment on VPS
- `refreshToken.ts`: `refreshAccessToken`, `persistTokens`
- `stockbitAuth.ts`: `TOKEN` (~24h), `REFRESH_TOKEN` (~7d)
- `growinAuth.ts`: `getGrowinCookie()` (base login) + shared `GROWIN_HEADERS` / `GROWIN_UA`
- `growinFetch.ts`: authed Growin REST (`growinFetch`, `growinAuthCookie`). Adds the PIN step on top of `getGrowinCookie`, dedupes the single-session login
- `growinWs.ts`: manual HTTP/1.1 WebSocket over TLS (`wsConnect`, `writeFrame`, `readFrame`). Shared by `growinDepth` (marketws) and `growinOrderWs` (order)

## util
- `date.ts`: `fmt`, `today`, `daysAgo`, `subDays`, `parseTFDays`
- `print.ts`: terminal formatting
- `protobuf.ts`: minimal protobuf wire reader/writer, shared by `growinDepth` + `growinOrderWs`

# Scoring (picker.ts)

Gated cross-validation, not additive. Regime gate first (SIT_OUT = stop).

1. **Foundation** (need ≥1, else skip): F1 bandar >0 and (above MA10 or accelerating) · F2 SM weekly net buy · F3 bandar >0 + accum/dist >0
2. **Confirmations**: C1 vol >1.5x + close high · C2 vol >2x + expanding trend · C3 bandar + SM 1d aligned · C4 +2%/1d + vol >1.5x · C5 retail sells while bandar buys · C6 higher lows 3d + close high · C7 bandar accel + vol >1.2x · C8 +3%/3d + bandar above MA10
3. **Contradictions**: X1 vol >2x + close low · X2 bandar buys, SM 1w sells · X3 +2%/1d on <0.8x vol · X4 +15%/5d + close low + red · X5 gap up closed red · X6 +5%/3d on collapsing vol
4. **Grade**: ≥2 contradictions = REJECT. Else A (4+ conf, 0 contr) · B (3+, 0) · C (2+, ≤1) · D (1+, 0) · else REJECT

# Regime Trap Filters (marketRegime.ts)

1. Dead cat: IHSG distMA20 < -3% and MA10 slope < 0 → force SIT_OUT
2. Exhaustion: 10d > +7% and today red → downgrade to DEFENSIVE
