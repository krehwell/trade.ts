// deno task analyze <symbol>
// Per-stock TA as JSON: MA distances, vol ratios, price structure, drawdown, range position,
// volume trend, red flags. Pulls 60d candles.
import { fetchCandles } from "./data/stockbitCandles.ts";
import { candleStats, distPct, sma } from "./market/indicators.ts";

const sym = Deno.args[0];
if (!sym) { console.log("Usage: deno task analyze SYMBOL"); Deno.exit(1); }

const candles = await fetchCandles({ symbol: sym, range: "60d", interval: "1d" });
if (!candles || candles.length < 10) { console.log(`${sym}: insufficient data`); Deno.exit(1); }

const c = candles;
const n = c.length;
const last = c[n - 1];

const closes = c.map((x) => x.close);

// Moving averages
const ma5 = sma(closes, 5);
const ma10 = sma(closes, 10);
const ma20 = sma(closes, 20);

// Shared per-candle metrics: same formulas the picker scores with.
const s = candleStats(c);
const { chg1d, chg3d, chg5d, volRatio5, volRatio10, cp, closedNearHigh, closedNearLow, gapUp } = s;
const volTrend = s.volShape3d;
const rangePos = s.rangePos10;
const hl3d = s.higherLows3d;

// Drawdown
const high60 = Math.max(...c.map(x => x.high));
const low60 = Math.min(...c.map(x => x.low));
const dd = ((last.close - high60) / high60) * 100;
const rangePos60 = high60 !== low60 ? (last.close - low60) / (high60 - low60) : 0.5;

// Red flags
const flags: string[] = [];
if (chg5d > 10 && volTrend === "CONTRACTING") flags.push("EXHAUSTION: ran hard, vol dying");
if (closedNearLow && chg1d < -3) flags.push("DISTRIBUTION: close near low on big red day");
if (gapUp && chg1d < -1) flags.push("GAP_REJECTION: gapped up then closed red");
if (volRatio5 > 2 && closedNearLow) flags.push("HIGH_VOL_DISTRIBUTION: vol spike + close low");
if (rangePos60 < 0.1 && chg1d < 0) flags.push("AT_LOWS: making new lows, no support");
if (last.close * last.volume < 1_000_000_000) flags.push("THIN: <1B value, can't exit");
if (dd < -40) flags.push("DEEP_DRAWDOWN: >40% from highs");

// Output
console.log(JSON.stringify({
    symbol: sym,
    close: last.close,
    open: last.open,
    high: last.high,
    low: last.low,
    volume: last.volume,
    chg1d: +chg1d.toFixed(1),
    chg3d: +chg3d.toFixed(1),
    chg5d: +chg5d.toFixed(1),
    ma5: +ma5.toFixed(0),
    ma10: +ma10.toFixed(0),
    ma20: +ma20.toFixed(0),
    distMA5: +distPct(last.close, ma5).toFixed(1),
    distMA10: +distPct(last.close, ma10).toFixed(1),
    distMA20: +distPct(last.close, ma20).toFixed(1),
    volRatio5: +volRatio5.toFixed(1),
    volRatio10: +volRatio10.toFixed(1),
    volTrend,
    rangePos: +(rangePos * 100).toFixed(0),
    cp: +cp.toFixed(0),
    closedNearHigh,
    closedNearLow,
    hl3d,
    gapUp,
    dd: +dd.toFixed(1),
    rangePos60: +(rangePos60 * 100).toFixed(0),
    flags,
    high60: +high60.toFixed(0),
    low60: +low60.toFixed(0),
}, null, 2));
