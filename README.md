# IDX Daily Stock Picker

Trading tools for the Indonesia Stock Exchange (IDX). Reads market regime, bandar (smart money) flow, and price action to find high-conviction overnight trades.

## How it works

1. **Regime.** IHSG trend, MAs, and breadth decide the environment: SIT_OUT / DEFENSIVE / NORMAL / AGGRESSIVE. Regime overrides every stock-level signal.
2. **Bandar flow.** The screener ranks stocks by cumulative bandar value, and the daily delta (today vs yesterday) shows who's actively accumulating.
3. **Price action.** Chartbit candles (near-realtime, Yahoo fallback) for the top flow names. Checks structure, volume, gaps, red flags.
4. **Gated scoring.** Foundation gate, then confirmations (cross-validated), then contradictions (vetoes), then a grade of A/B/C/D/REJECT.
5. **Regime-adjusted targets.** TP and stops scale to regime. SIT_OUT is about +1.7% TP, AGGRESSIVE is +8% to +15%.

## Setup

Needs [Deno](https://deno.land/).

1. Put a Stockbit token in `net/stockbitAuth.ts` (`deno task refresh` renews it).
2. For live orderbook only: fill in the Growin login in `.env` (it logs in and refreshes the session itself).
3. Run `deno task daily` first, then dig in.

## Tasks

```
deno task daily                            run first: regime, full scan, candles for top flow
deno task pick                             gated scoring pipeline, graded picks
deno task analyze <symbol>                 per-stock TA (MAs, vol, structure, red flags)
deno task bandar <symbol> [days=20]        day-by-day SM flow vs price for one stock
deno task bandar-top [date=today] [n=15]   what bandar bought that day, all stocks ranked
deno task orderbook <symbol>               live bid/offer ladder (Growin), market hours only
deno task refresh                          renew the Stockbit token
```

## Layout

Entry points live at the root, everything else is grouped by role.

```
daily.ts          run first: regime + scan + top candles
picker.ts         gated scoring pipeline
analyzeStock.ts   per-stock TA
bandarHistory.ts  one stock's SM flow timeline (deno task bandar)
bandarToday.ts    one day's SM flow across all stocks (deno task bandar-top)
orderbook.ts      live orderbook snapshot (deno task orderbook)
refresh.ts        token refresh

market/
  marketRegime.ts   IHSG regime detector (trend + breadth + trap filters)
  indicators.ts     shared TA formulas (sma, pctChange, distPct, maSlope, avgVolume)
data/
  stockbitCandles.ts   candle source of record, Stockbit first with Yahoo fallback
  yahooCandles.ts      Yahoo candles (fallback only)
  fetchScreener.ts     screener API with auto-pagination
  fetchBrokerActivity.ts   SM/retail broker flow; owns the canonical SM_BROKERS set
  screenerItems.ts     screener item IDs (BANDAR_VALUE, LAST_PRICE, …)
  growinDepth.ts       live orderbook depth over protobuf WebSocket (Growin)
net/
  stockbitFetch.ts   Stockbit HTTP wrapper (auth + base URL, auto-refresh on 401)
  warpClient.ts      HTTP client (optional SOCKS proxy for VPS)
  refreshToken.ts    token refresh + persist to stockbitAuth.ts
  stockbitAuth.ts    Stockbit tokens (access ~24h + refresh ~7d)
  growinAuth.ts      Growin login for live orderbook (creds from .env, auto-refreshes)
util/
  date.ts    date helpers
  print.ts   terminal formatting
```

## API notes

- Screener only returns **filter** columns, not sequence columns.
- `BANDAR_VALUE` is cumulative, so daily flow = `BANDAR_VALUE - BANDAR_PREV_VALUE`. A stock can show a big positive total but be net selling today, so always use the delta.
- Bandar *history* isn't in the screener (it's snapshot-only), but `/order-trade/broker/activity` takes a date range, and `bandar` / `bandar-top` reconstruct the timeline from it.
- Broker activity is rate-limited: fetch sequentially, not in parallel, or you get silent-zero payloads.
- Live orderbook is paywalled on Stockbit but open on Growin (Mirae) over a protobuf WebSocket. That's `orderbook.ts`.
- Candles: Stockbit chartbit first, Yahoo fallback. IHSG = `^JKSE`, IDX stocks get `.JK` auto-appended.
