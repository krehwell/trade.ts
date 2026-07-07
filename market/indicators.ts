// Shared technical analysis formulas.  All array inputs are chronological
// (oldest first), matching the candle order returned by the candle fetchers.

// Simple moving average of the last `period` values.  NaN if not enough data.
export const sma = (values: number[], period: number): number =>
    values.length < period ? NaN : values.slice(-period).reduce((s, v) => s + v, 0) / period;

// Percent change from `from` to `to`.  Returns 0 when `from` is non positive or NaN
// (guards divide by zero and treats "no data" as a neutral 0).
export const pctChange = (from: number, to: number): number =>
    from > 0 ? ((to - from) / from) * 100 : 0;

// Distance of a price from a moving average, in %.
export const distPct = (price: number, ma: number): number => pctChange(ma, price);

// % change of SMA(period) now vs `lookback` bars ago.  0 if insufficient data.
export const maSlope = (values: number[], period: number, lookback: number): number => {
    const now = sma(values, period);
    const past = sma(values.slice(0, -lookback), period);
    return isNaN(now) || isNaN(past) ? 0 : pctChange(past, now);
};

// Average volume over `period` bars, optionally excluding the latest
// (in progress) bar.  Pass excludeLast=true during market hours.
export const avgVolume = (volumes: number[], period: number, excludeLast = false): number =>
    sma(excludeLast ? volumes.slice(0, -1) : volumes, period);

export interface CandleLike {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface CandleStats {
    chg1d: number;
    chg3d: number;
    chg5d: number;
    avgVol5: number;        // trailing 5 bars, today excluded
    avgVol10: number;       // trailing 10 bars, today excluded
    volRatio5: number;
    volRatio10: number;
    volTrend5d: number;     // (lastVol - vol 4 bars ago) / vol 4 bars ago, >0 expanding
    volShape3d: "EXPANDING" | "CONTRACTING" | "MIXED"; // 3-bar monotonic shape
    rangePos10: number;     // 0 = at 10d low, 1 = at 10d high
    cp: number;             // close position in today's range, 0..100
    closedNearHigh: boolean; // cp > 70
    closedNearLow: boolean;  // cp < 30
    higherLows3d: boolean;
    gapUp: boolean;
}

// Single source of truth for per-stock candle metrics (picker scoring,
// analyze output).  Candles chronological, needs >= 2 bars.
export const candleStats = (c: CandleLike[]): CandleStats => {
    const last = c.length - 1;
    const t = c[last];
    const y = c[last - 1];

    const chg1d = pctChange(y.close, t.close);
    const chg3d = last >= 3 ? pctChange(c[last - 3].close, t.close) : 0;
    const chg5d = last >= 5 ? pctChange(c[last - 5].close, t.close) : 0;

    const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
    const avgVol5 = mean(c.slice(-6, -1).map((x) => x.volume));
    const avgVol10 = mean(c.slice(-11, -1).map((x) => x.volume));
    const volRatio5 = t.volume / (avgVol5 || 1);
    const volRatio10 = t.volume / (avgVol10 || 1);

    const vols5 = c.slice(-5).map((x) => x.volume);
    const volTrend5d = vols5.length >= 2 ? (vols5[vols5.length - 1] - vols5[0]) / (vols5[0] || 1) : 0;
    const v3 = c.slice(-3).map((x) => x.volume);
    const volShape3d = v3.length === 3 && v3[2] > v3[1] && v3[1] > v3[0] ? "EXPANDING"
        : v3.length === 3 && v3[2] < v3[1] && v3[1] < v3[0] ? "CONTRACTING"
        : "MIXED";

    const high10 = Math.max(...c.slice(-10).map((x) => x.high));
    const low10 = Math.min(...c.slice(-10).map((x) => x.low));
    const rangePos10 = high10 !== low10 ? (t.close - low10) / (high10 - low10) : 0.5;

    const todayRange = t.high - t.low;
    const cp = todayRange > 0 ? ((t.close - t.low) / todayRange) * 100 : 50;

    const higherLows3d = last >= 2 && c[last].low >= c[last - 1].low && c[last - 1].low >= c[last - 2].low;

    return {
        chg1d, chg3d, chg5d,
        avgVol5, avgVol10, volRatio5, volRatio10,
        volTrend5d, volShape3d, rangePos10,
        cp, closedNearHigh: cp > 70, closedNearLow: cp < 30,
        higherLows3d, gapUp: t.open > y.close,
    };
};

if (import.meta.main) {
    const assert = (c: boolean, m: string) => {
        if (!c) throw new Error("FAIL: " + m);
    };
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    const closes = [10, 11, 12, 13, 14, 15];

    assert(sma(closes, 3) === 14, "sma last-3 = (13+14+15)/3");
    assert(isNaN(sma([1, 2], 3)), "sma NaN when insufficient");
    assert(pctChange(10, 11) === 10, "pctChange +10%");
    assert(pctChange(0, 5) === 0, "pctChange div0 -> 0");
    assert(distPct(11, 10) === 10, "distPct price above MA");
    // now=sma([13,14,15])=14, past=sma([11,12,13])=12, so +16.6%
    assert(near(maSlope(closes, 3, 2), (14 - 12) / 12 * 100), "maSlope rising");
    assert(maSlope([1, 2], 3, 1) === 0, "maSlope 0 when insufficient");
    assert(avgVolume([100, 200, 300], 2) === 250, "avgVolume last-2");
    assert(avgVolume([100, 200, 300], 2, true) === 150, "avgVolume exclude last");

    const bar = (close: number, volume: number, low = close - 2, high = close + 2, open = close - 1): { open: number; high: number; low: number; close: number; volume: number } =>
        ({ open, high, low, close, volume });
    const cs = candleStats([bar(100, 10), bar(102, 20), bar(104, 30), bar(106, 40), bar(108, 50), bar(110, 100)]);
    assert(near(cs.chg1d, (110 - 108) / 108 * 100), "candleStats chg1d");
    assert(near(cs.chg3d, (110 - 104) / 104 * 100), "candleStats chg3d");
    assert(near(cs.chg5d, (110 - 100) / 100 * 100), "candleStats chg5d");
    assert(cs.avgVol5 === 30, "candleStats avgVol5 = mean(10..50), today excluded");
    assert(near(cs.volRatio5, 100 / 30), "candleStats volRatio5");
    assert(cs.volShape3d === "EXPANDING", "candleStats volShape3d");
    assert(cs.higherLows3d, "candleStats higher lows");
    assert(cs.gapUp, "candleStats gapUp (open 109 > prev close 108)");
    assert(cs.cp === 50 && !cs.closedNearHigh && !cs.closedNearLow, "candleStats cp mid-range");

    console.log("indicators: all checks passed");
}
