# IDX Daily Stock Picker

Daily stock picker for Indonesia Stock Exchange (IDX). Uses market regime detection, bandar (smart money) flow analysis, and gated scoring to find high-conviction overnight trades.

## How It Works

1. **Regime Detection** — Checks IHSG trend, MAs, breadth to determine market environment (SIT_OUT / DEFENSIVE / NORMAL / AGGRESSIVE). Regime overrides all stock-level signals.
2. **Bandar Flow Scan** — Screener pulls top stocks by cumulative bandar value, computes daily delta (today vs yesterday) to find active accumulation.
3. **Price Action Analysis** — Yahoo Finance candles for top flow stocks. Checks structure, volume confirmation, gap behavior, red flags.
4. **Gated Scoring** — Foundation gate (must pass) → confirmations (cross-validated) → contradictions (vetoes) → grade A/B/C/D/REJECT.
5. **Regime-Adjusted Targets** — TP and stops scaled to regime. SIT_OUT = +2% TP, AGGRESSIVE = +8-15% TP.

## Setup

Requires [Deno](https://deno.land/).

1. Get a Stockbit API token (Bearer JWT) and put it in `utils/constants.ts`
2. Run: `deno task daily` to get all data, then analyze

## Tasks

```
deno task daily   — RUN FIRST: regime + full screener scan + candles for top flow stocks
deno task pick    — Automated gated scoring pipeline
deno task check   — Quick candle viewer for watchlist + IHSG
deno task test    — Run tests
```

## Project Structure

```
daily.ts                — RUN FIRST each session: regime + scan + top candles in one command
picker.ts               — Automated gated scoring pipeline (regime → screener → scoring → picks)
picks_check.ts          — Quick candle check for watchlist stocks + IHSG
marketRegime.ts         — IHSG regime detector (trend + breadth + trap filters)
fetchScreener.ts        — Stockbit screener API with auto-pagination
fetchBrokerActivity.ts  — SM/retail broker flow across timeframes
utils/
  screenerItems.ts      — Screener filter item IDs (BANDAR_VALUE, LAST_PRICE, etc.)
  yahooFetch.ts         — Yahoo Finance candles (fetchCandles, fetchYahooDaily)
  stockbitFetch.ts      — Stockbit API wrapper (auth + base URL)
  constants.ts          — API auth token (expires ~24hrs)
  date.ts               — Date helpers
  print.ts              — Terminal output formatting
```

## Key API Notes

- Screener only returns data for **filter** columns, not sequence columns
- `BANDAR_VALUE` is cumulative — compute daily delta via `BANDAR_VALUE - BANDAR_PREV_VALUE`
- Stockbit chartbit is paywalled for individual stocks — use Yahoo Finance for candles
- IHSG Yahoo ticker: `^JKSE` | IDX stocks: auto-appended `.JK`
