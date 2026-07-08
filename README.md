# IDX Daily Stock Picker

Trading tools for the Indonesia Stock Exchange (IDX). Reads market regime, bandar (smart money) flow, and price action to find high-conviction overnight trades, and (via Growin/Mirae) reads the live account and places orders.

## How it works

1. **Regime.** IHSG trend, MAs, and breadth decide the environment: SIT_OUT / DEFENSIVE / NORMAL / AGGRESSIVE. Regime overrides every stock-level signal.
2. **Bandar flow.** The screener ranks stocks by cumulative bandar value, and the daily delta (today vs yesterday) shows who's actively accumulating.
3. **Price action.** Chartbit candles (near-realtime, Yahoo fallback) for the top flow names. Checks structure, volume, gaps, red flags.
4. **Gated scoring.** Foundation gate, then confirmations (cross-validated), then contradictions (vetoes), then a grade of A/B/C/D/REJECT.
5. **Regime-adjusted targets.** TP and stops scale to regime. SIT_OUT is about +1.7% TP, AGGRESSIVE is +8% to +15%.

## Setup

Needs [Deno](https://deno.land/).

1. Put a Stockbit token in `net/stockbitAuth.ts` (`deno task refresh` renews it).
2. For Growin features (live orderbook, account, orders): fill the Growin login in `.env` (`GROWIN_EMAIL` / `GROWIN_PASSWORD` / `GROWIN_DEVICE_ID`). Account and order reads also need the trading `GROWIN_PIN`. See `.env.example`.
3. Run `deno task daily` first, then dig in.

## Tasks

```
deno task daily                            run first: regime, full scan, candles for top flow
deno task pick                             gated scoring pipeline, graded picks
deno task analyze <symbol>                 per-stock TA (MAs, vol, structure, red flags)
deno task bandar <symbol> [days=20]        day-by-day SM flow vs price for one stock
deno task bandar-top [date=today] [n=15]   what bandar bought that day, all stocks ranked
deno task trap                             premarket trap probability (0-100)
deno task orderbook <symbol>               live bid/offer ladder (Growin), market hours only
deno task account [days=30]                Growin account: cash, holdings, live/done orders, P&L
deno task order <cmd>                      place/manage Growin orders (see below)
deno task refresh                          renew the Stockbit token
```

### Orders (Growin)

`deno task order` has two order paths:

- **Auto-order** (REST, conditional): `buy` / `sell` / `stop` / `resume` / `cancel`. Fires when the price crosses a trigger, never instantly. A new order is created paused and auto-played.
- **Direct order** (WebSocket, instant fill): `dbuy` / `dsell`, plus `dwithdraw` / `damend` to pull or reprice a resting order.

```
deno task order list                          all auto-orders (with pause/play state)
deno task order buy  <sym> <lot> <cond> <exec>   e.g. buy GOTO 5 ge=2000 at=2400
deno task order sell <sym> <lot> <cond> <exec>   cond = le=<price>|ge=<price>, exec = at=<price>|tick=<n>
                     add until=<YYYY-MM-DD> or until=+<days> to keep it valid past today
deno task order edit <uuid> <field>...        edit in place (same tokens, e.g. ge=105 lot=2 until=+7)
deno task order dbuy <sym> <lot> <price>      instant buy over WS
deno task order cancel <uuid>                 delete an auto-order
deno task order dwithdraw <marketId> <internalId> <sequence>
```

Direct orders share Growin's single session with the app. With the app open the ack may not return, but the order still lands and the CLI recovers it from the order-list, so prefer the app closed anyway.

## Layout

Entry points live at the root. Everything else is grouped by role under `market/`, `data/`, `net/`, `util/`. **`CLAUDE.md` has the per-module breakdown** (functions, constraints, the API traps that bite). That's the one place it lives, kept current there instead of copied here.

## API notes

Every data source has traps (cumulative bandar value, rate-limited broker activity, conditional vs instant orders, candle sourcing). They're documented once in **`CLAUDE.md` > API Quirks** so they can't drift out of sync.
