/**
 * Multi-symbol morning check utility.
 * Pulls intraday 5m candles for IHSG + watchlist symbols.
 * Used by the 9:31 AM (valuation) and 9:35 AM (decision) crons.
 *
 * Usage: deno run --allow-net utils/intradayCheck.ts SYM1 SYM2 SYM3 ...
 * Outputs JSON with intraday data + computed metrics.
 */
import { fetchCandles } from "./stockbitCandles.ts";

interface IntradayMetrics {
    open: number;
    now: number;
    high: number;
    low: number;
    chgPct: number;       // change from open
    prevClose: number;
    gapPct: number;       // gap from yesterday's close
    volume: number;
    candleCount: number;
}

async function checkSymbol(symbol: string): Promise<IntradayMetrics | null> {
    const candles = await fetchCandles({ symbol, range: "1d", interval: "5m" });
    if (!candles || candles.length === 0) return null;

    // Also get yesterday's daily candle for gap calculation
    const daily = await fetchCandles({ symbol, range: "2d", interval: "1d" });
    const prevClose = daily && daily.length >= 2 ? daily[daily.length - 2].close : candles[0].open;

    const first = candles[0];
    const last = candles[candles.length - 1];
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const totalVol = candles.reduce((s, c) => s + c.volume, 0);

    return {
        open: first.open,
        now: last.close,
        high,
        low,
        chgPct: ((last.close - first.open) / first.open) * 100,
        prevClose,
        gapPct: ((first.open - prevClose) / prevClose) * 100,
        volume: totalVol,
        candleCount: candles.length,
    };
}

// ─── Main ───────────────────────────────────────────────────
const symbols = Deno.args.length > 0 ? Deno.args : ["BRIS"];

// Fetch IHSG first
const ihsg = await checkSymbol("^JKSE");

// Fetch all symbols
const results: Record<string, IntradayMetrics | null> = {};
for (const sym of symbols) {
    results[sym] = await checkSymbol(sym);
}

console.log(JSON.stringify({ ihsg, symbols: results }, null, 2));
