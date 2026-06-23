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
    // now=sma([13,14,15])=14 ; past=sma([11,12,13])=12 ; +16.6%
    assert(near(maSlope(closes, 3, 2), (14 - 12) / 12 * 100), "maSlope rising");
    assert(maSlope([1, 2], 3, 1) === 0, "maSlope 0 when insufficient");
    assert(avgVolume([100, 200, 300], 2) === 250, "avgVolume last-2");
    assert(avgVolume([100, 200, 300], 2, true) === 150, "avgVolume exclude last");

    console.log("indicators: all checks passed");
}
