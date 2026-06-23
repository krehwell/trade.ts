/**
 * Per-stock technical analysis utility.
 * Pulls 60d candles, computes: MA distances, volume ratios, price structure,
 * drawdown, range position, volume trend, red flags.
 *
 * Usage: deno run --allow-net utils/analyzeStock.ts SYMBOL
 */
import { fetchCandles } from "./stockbitCandles.ts";
import { avgVolume, distPct, pctChange, sma } from "./indicators.ts";

const sym = Deno.args[0];
if (!sym) { console.log("Usage: deno run --allow-net utils/analyzeStock.ts SYMBOL"); Deno.exit(1); }

const candles = await fetchCandles({ symbol: sym, range: "60d", interval: "1d" });
if (!candles || candles.length < 10) { console.log(`${sym}: insufficient data`); Deno.exit(1); }

const c = candles;
const n = c.length;
const last = c[n - 1];

const closes = c.map((x) => x.close);
const vols = c.map((x) => x.volume);

// Moving averages
const ma5 = sma(closes, 5);
const ma10 = sma(closes, 10);
const ma20 = sma(closes, 20);

// Price metrics
const chg1d = pctChange(c[n - 2].close, last.close);
const chg3d = n >= 4 ? pctChange(c[n - 4].close, last.close) : 0;
const chg5d = n >= 6 ? pctChange(c[n - 6].close, last.close) : 0;

// Volume (exclude today's in-progress bar)
const avgVol5 = avgVolume(vols, 5, true);
const avgVol10 = avgVolume(vols, 10, true);
const volRatio5 = last.volume / (avgVol5 || 1);
const volRatio10 = last.volume / (avgVol10 || 1);

// Volume trend (last 3 days: expanding or contracting)
const last3vols = c.slice(-3).map(x => x.volume);
const volTrend = last3vols[2] > last3vols[1] && last3vols[1] > last3vols[0] ? "EXPANDING" :
                 last3vols[2] < last3vols[1] && last3vols[1] < last3vols[0] ? "CONTRACTING" : "MIXED";

// Range position (10d)
const h10 = Math.max(...c.slice(-10).map(x => x.high));
const l10 = Math.min(...c.slice(-10).map(x => x.low));
const rangePos = h10 !== l10 ? (last.close - l10) / (h10 - l10) : 0.5;

// Close position
const todayRange = last.high - last.low;
const cp = todayRange > 0 ? ((last.close - last.low) / todayRange) * 100 : 50;
const closedNearHigh = cp > 70;
const closedNearLow = cp < 30;

// Higher lows
const hl3d = n >= 3 && c[n-1].low >= c[n-2].low && c[n-2].low >= c[n-3].low;

// Gap
const gapUp = last.open > c[n-2].close;

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
if (last.volume < 500_000_000 && volRatio5 < 0.5) flags.push("THIN: volume too low to exit");
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
