# IDX Daily Stock Picker

Daily stock picker for Indonesia Stock Exchange (IDX). Uses market regime detection, bandar (smart money) flow analysis, and gated scoring to find high-conviction overnight trades.

## How It Works

1. **Regime Detection** — Checks IHSG trend, MAs, breadth to determine market environment (SIT_OUT / DEFENSIVE / NORMAL / AGGRESSIVE). Regime overrides all stock-level signals.
2. **Bandar Flow Scan** — Screener pulls top stocks by cumulative bandar value, computes daily delta (today vs yesterday) to find active accumulation.
3. **Price Action Analysis** — Stockbit chartbit candles (near-realtime) for top flow stocks, with Yahoo Finance fallback. Checks structure, volume confirmation, gap behavior, red flags.
4. **Gated Scoring** — Foundation gate (must pass) → confirmations (cross-validated) → contradictions (vetoes) → grade A/B/C/D/REJECT.
5. **Regime-Adjusted Targets** — TP and stops scaled to regime. SIT_OUT = +2% TP, AGGRESSIVE = +8-15% TP.

## Setup

Requires [Deno](https://deno.land/).

1. Get a Stockbit API token (Bearer JWT) and put it in `src/net/constants.ts`
2. Run: `deno task daily` to get all data, then analyze

## Tasks

```
deno task daily        — RUN FIRST: regime + full screener scan + candles for top flow stocks
deno task pick         — Automated gated scoring pipeline
deno task analyze SYM  — Per-stock technical analysis (MAs, vol, structure, red flags)
```

## Project Structure

```
# entry points (root) — run via deno task
daily.ts                  — RUN FIRST each session: regime + scan + top candles
picker.ts                 — Automated gated scoring pipeline (regime → screener → scoring → picks)
analyzeStock.ts           — Per-stock technical analysis CLI (deno task analyze SYM)
refresh.ts                — Refresh the Stockbit token (deno task refresh)

src/
  market/                 — domain logic
    marketRegime.ts       — IHSG regime detector (trend + breadth + trap filters)
    indicators.ts         — Shared TA formulas (sma, pctChange, distPct, maSlope, avgVolume)
  data/                   — market data sources
    stockbitCandles.ts    — Candle source of record: Stockbit-first w/ Yahoo fallback (fetchCandles, fetchDaily, fetchDailyMulti)
    yahooCandles.ts       — Yahoo Finance candles (fallback source)
    fetchScreener.ts      — Stockbit screener API with auto-pagination
    fetchBrokerActivity.ts — SM/retail broker flow across timeframes
    screenerItems.ts      — Screener filter item IDs (BANDAR_VALUE, LAST_PRICE, etc.)
  net/                    — transport, auth, config
    stockbitFetch.ts      — Stockbit HTTP wrapper (auth + base URL, auto-refresh on 401)
    warpClient.ts         — HTTP client (optional SOCKS proxy for VPS)
    refreshToken.ts       — Token refresh + persist to constants.ts
    constants.ts          — API auth tokens (access ~24h + refresh ~7d)
  util/                   — pure helpers
    date.ts               — Date helpers
    print.ts              — Terminal output formatting
```

## Key API Notes

- Screener only returns data for **filter** columns, not sequence columns
- `BANDAR_VALUE` is cumulative — compute daily delta via `BANDAR_VALUE - BANDAR_PREV_VALUE`
- Candles come from Stockbit chartbit (near-realtime); auto-falls back to Yahoo Finance when chartbit has no data or for index symbols (`^JKSE`)
- IHSG Yahoo ticker: `^JKSE` | IDX stocks: auto-appended `.JK`
