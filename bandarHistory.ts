// Day-by-day SM/bandar net flow vs price for one stock. The accumulation timeline
// the screener's snapshot BANDAR_VALUE can't show. About 13 requests per day, so 20d takes ~1 min.
//   deno task bandar <symbol> [days=20]
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

console.log(`\n=== ${symbol} SM net flow per day (${recent.length}d, brokers: ${SM_BROKERS.join(",")}) ===\n`);
console.log("date        close    chg%      flow      cum");

let cum = 0;
const flowsB: number[] = [];
for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    const flow = (await fetchBrokerActivity({ brokers: SM_BROKERS, from: c.date, to: c.date }))[symbol] ?? 0;
    cum += flow;
    flowsB.push(flow / 1e9);
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

// Accumulation framework: consistency over spikes. Needs >= 7 days of data.
if (flowsB.length >= 7) {
    const last3 = flowsB.slice(-3);
    const last7 = flowsB.slice(-7);
    const green3 = last3.filter((f) => f > 0).length;
    const green7 = last7.filter((f) => f > 0).length;
    const cum7 = last7.reduce((a, b) => a + b, 0);
    const pos7 = last7.filter((f) => f > 0).reduce((a, b) => a + b, 0);
    const neg7 = Math.abs(last7.filter((f) => f < 0).reduce((a, b) => a + b, 0));
    const ratio = neg7 > 0 ? pos7 / neg7 : Infinity;
    // One day carrying most of the buying = event, no matter how many small green days surround it.
    const lastDay = flowsB[flowsB.length - 1];
    const spike = lastDay > 0 && pos7 > 0 && lastDay > 0.5 * pos7;

    const chgPeriod = ((recent[recent.length - 1].close - recent[0].close) / recent[0].close) * 100;
    const phase = Math.abs(chgPeriod) < 5 ? "flat (stealth)" : chgPeriod >= 5 ? `markup (+${chgPeriod.toFixed(0)}% in period)` : `decline (${chgPeriod.toFixed(0)}% in period)`;

    const accum = cum7 > 0 && (green7 >= 5 || ratio >= 3) && green3 >= 2;
    const distrib = cum7 < 0 && (green7 <= 2 || ratio <= 1 / 3);
    const verdict = spike ? "EVENT BUY (one day > 50% of 7d buying. Conditional entry only)"
        : accum ? "ACCUMULATION"
        : distrib ? "DISTRIBUTION"
        : "NOISE (no consistent flow)";

    console.log(`\nChecks: 3d ${green3}/3 green | 7d ${green7}/7 green, cum ${(cum7 >= 0 ? "+" : "") + cum7.toFixed(1)}B, buy/sell ratio ${ratio === Infinity ? "inf" : ratio.toFixed(1)}x | price ${phase}`);
    console.log(`VERDICT: ${verdict}`);
}
console.log("Note: per-broker top-200 rows only, so thin stocks can drop out of a broker's list on quiet days.");
