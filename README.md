# IDX Stock Scanner (Technique VS Bandar)

A dual-flow scanner for Indonesia Stock Exchange (IDX) stocks. Finds
high-conviction entries by intersecting technical reversal signals with smart
money accumulation.

## How It Works

The scanner runs two independent scoring flows, then intersects them:

**Flow A — Technical & Price Action** Screens for liquid, profitable stocks that
are recently declining, then scores them on technical reversal signals: RSI
oversold, MACD bullish crossover, Bollinger Band touches, and price vs MA50.

**Flow B — Smart Money Broker Activity** Tracks 14 institutional broker codes
across multiple timeframes, cross-referenced with retail broker flow and volume
expansion. Looks for divergence: smart money accumulating while retail
distributes.

**Intersection = High Conviction** Stocks in both flows — technical setup
confirmed by institutional buying.

## Setup

Requires [Deno](https://deno.land/).

1. Get a Stockbit API token (Bearer JWT) and put it in `utils/constants.ts`
2. Run: `deno task start`

## Project Structure

```
index.ts                — Main scanner entry point (flowA + flowB → intersection)
indicators.ts           — Technical indicators: RSI, MACD, Bollinger, SMA, EMA, volume EMA ratio
fetchBrokerActivity.ts  — Broker net flow (multi-broker, multi-timeframe, top brokers)
fetchScreener.ts        — Stockbit screener API with auto-pagination
fetchStockPrice.ts      — Daily + intraday candles via chartbit API
screenerItems.ts        — 100+ screener filter item IDs (fundamentals, valuation, bandarmology)
utils/
  constants.ts          — API auth token
  fetch.ts              — fetchGET, fetchPOST (auth + base URL baked in)
  print.ts              — Table formatting and console output
  date.ts               — Date helpers (fmt, today, daysAgo, subDays, parseTFDays)
```

## Scoring

### Flow A (min score: 4)

| Signal             | Condition                        | Points |
| ------------------ | -------------------------------- | ------ |
| Deep oversold      | RSI < 30                         | +3     |
| Mild oversold      | RSI 30–40                        | +1     |
| MACD bullish cross | Histogram flips + in last 3 bars | +3     |
| MACD line > signal | Bullish momentum                 | +1     |
| Touched lower BB   | Low ≤ lower band in last 3 bars  | +2     |
| Above MA50         | Price > SMA(50)                  | +1     |

### Flow B (min score: 4)

| Signal               | Condition                  | Points |
| -------------------- | -------------------------- | ------ |
| SM 1w accumulating   | SM 1w net > 0              | +5     |
| Volume surging       | EMA5/EMA50 ratio > 1.5x    | +4     |
| Volume expanding     | EMA5/EMA50 ratio > 1.2x    | +2     |
| Retail distributing  | Retail 1w net < 0          | +2     |
| All-TF consistency   | SM 1d, 1w, 1m all positive | +1     |
| Foreign flow confirm | Candle foreign 7d > 0      | +1     |

Hard filter: net foreign flow over last 7 trading days must exceed 100M IDR.
