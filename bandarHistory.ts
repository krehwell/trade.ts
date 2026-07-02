// Day-by-day SM/bandar net flow history for one stock, plotted against price.
// Reconstructs what the screener's BANDAR_VALUE can't give (snapshot-only): the
// accumulation/distribution timeline. One broker/activity call per SM broker per
// day, sequential — ~13 requests/day, so 20d ≈ 1 min. Usage:
//   deno task bandar SYM [days=20]
import { fetchBrokerActivity, SM_BROKERS } from "./data/fetchBrokerActivity.ts";
import { fetchDaily } from "./data/stockbitCandles.ts";

const symbol = Deno.args[0]?.toUpperCase();
if (!symbol) {
    console.error("Usage: deno task bandar <symbol> [days=20]");
    Deno.exit(1);
}
const days = Number(Deno.args[1] ?? 20);

// Candle dates = trading-day list (skips weekends/holidays) + price context
const candles = await fetchDaily({ symbol: symbol, days: days + 5 });
const recent = candles.slice(-days);
if (recent.length === 0) {
    console.error(`No candles for ${symbol}`);
    Deno.exit(1);
}

console.log(`\n=== ${symbol} — SM net flow per day (${recent.length}d, brokers: ${SM_BROKERS.join(",")}) ===\n`);
console.log("date        close    chg%      flow      cum");

let cum = 0;
for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const flow = (await fetchBrokerActivity({ brokers: SM_BROKERS, from: c.date, to: c.date }))[symbol] ?? 0;
    cum += flow;
    const prev = i > 0 ? recent[i - 1].close : candles[candles.length - days - 1]?.close;
    const chg = prev ? ((c.close - prev) / prev) * 100 : 0;
    const fB = flow / 1e9;
    const bar = "█".repeat(Math.min(30, Math.round(Math.abs(fB) / 2)));
    console.log(
        `${c.date}  ${String(c.close).padStart(6)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(1).padStart(4)}%  ` +
            `${(fB >= 0 ? "+" : "") + fB.toFixed(1) + "B"} `.padStart(9) +
            `${((cum >= 0 ? "+" : "") + (cum / 1e9).toFixed(1) + "B").padStart(8)}  ${fB >= 0 ? "" : "-"}${bar}`,
    );
}

console.log(`\nCum ${recent.length}d SM flow: ${(cum / 1e9).toFixed(1)}B`);
console.log("Note: per-broker top-200 rows only — thin stocks can drop out of a broker's list on quiet days.");
