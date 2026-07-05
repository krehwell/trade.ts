/**
 * Daily analysis script. Run once per session to get all the data needed.
 * Outputs: IHSG regime, full screener scan with daily deltas, candles for top stocks.
 *
 * Usage: deno task daily
 */

import { fetchCandles } from "./data/stockbitCandles.ts";
import { fetchBandarDeltas, fetchScreener } from "./data/fetchScreener.ts";
import { fetchLatestForeignFlow } from "./data/fetchForeignFlow.ts";
import { ITEMS } from "./data/screenerItems.ts";
import { distPct, maSlope, pctChange, sma } from "./market/indicators.ts";
import { detectRegime, printRegime } from "./market/marketRegime.ts";

// ─── IHSG REGIME ────────────────────────────────────────────────────────────

console.log("━".repeat(70));
console.log("  IHSG REGIME CHECK");
console.log("━".repeat(70));

// Authoritative regime: the SAME detector the picker uses (IHSG trend + breadth
// + trap filters).  Single source of truth, so don't compute a separate verdict here.
const reg = await detectRegime();
printRegime(reg);

// Supplementary IHSG technicals + recent candle table (detail printRegime omits).
const ihsg = await fetchCandles({ symbol: "^JKSE", range: "60d", interval: "1d" });
if (!ihsg || ihsg.length === 0) {
    console.log("ERROR: No IHSG candle data. Check network.");
    Deno.exit(1);
}

const closes = ihsg.map((c) => c.close);
const n = closes.length;
const close = ihsg[n - 1].close;
const ma20 = sma(closes, 20);
const ma10Slope = maSlope(closes, 10, 5);
const distMA20 = distPct(close, ma20);
const close10dAgo = closes[n - 11] || closes[0];
const chg10d = pctChange(close10dAgo, close);
const date = new Date(ihsg[n - 1].date * 1000).toISOString().slice(0, 10);

console.log(
    `\n  IHSG technicals (${date}): Dist MA20 ${distMA20 >= 0 ? "+" : ""}${distMA20.toFixed(2)}% | MA10 slope (5d) ${ma10Slope >= 0 ? "+" : ""}${ma10Slope.toFixed(2)}% | 10d change ${chg10d >= 0 ? "+" : ""}${chg10d.toFixed(2)}%`,
);

console.log("\n  Last 10 days:");
for (const c of ihsg.slice(-10)) {
    const d = new Date(c.date * 1000).toISOString().slice(0, 10);
    const chg = ((c.close - c.open) / c.open * 100).toFixed(2);
    console.log(
        `    ${d} O:${c.open.toFixed(0)} H:${c.high.toFixed(0)} L:${c.low.toFixed(0)} C:${c.close.toFixed(0)} Chg:${chg}%`,
    );
}

// ─── SCREENER SCAN ──────────────────────────────────────────────────────────

console.log("\n" + "━".repeat(70));
console.log("  BANDAR FLOW SCAN (all positive bandar, top 50 by daily delta)");
console.log("━".repeat(70));

const enriched = await fetchBandarDeltas();

// Breadth: count negative bandar stocks
const negPage = await fetchScreener({
    filters: [{ id: ITEMS.BANDAR_VALUE, operator: "<", value: 0 }],
    page: 1,
    perPage: 1,
});
const breadth = ((enriched.length / (enriched.length + negPage.totalRows)) * 100).toFixed(1);

console.log(
    `Positive bandar: ${enriched.length} | Negative: ${negPage.totalRows} | Breadth: ${breadth}%\n`,
);

console.log("Rank | Ticker | BandarCum  | BandarPrev | DailyDelta");
console.log("-".repeat(60));
for (let i = 0; i < Math.min(enriched.length, 50); i++) {
    const s = enriched[i];
    const sign = s.delta >= 0 ? "+" : "";
    console.log(
        `${String(i + 1).padStart(2)}   | ${s.symbol.padEnd(6)} | ${(s.bandar / 1e9).toFixed(1).padStart(9)}B | ${(s.bandarPrev / 1e9).toFixed(1).padStart(9)}B | ${sign}${(s.delta / 1e9).toFixed(1).padStart(7)}B`,
    );
}

// ─── FOREIGN FLOW (IDX) ─────────────────────────────────────────────────────

const top10 = enriched.filter((s) => s.delta > 0).slice(0, 10);

const { date: ffDate, flows } = await fetchLatestForeignFlow().catch(() => ({ date: "", flows: [] }));
if (flows.length > 0) {
    console.log("\n" + "━".repeat(70));
    console.log(`  FOREIGN FLOW (IDX, ${ffDate})`);
    console.log("━".repeat(70));

    const byNet = [...flows].sort((a, b) => b.foreignNetValue - a.foreignNetValue);
    console.log("\nTop 10 foreign net buy:");
    for (const f of byNet.slice(0, 10)) {
        console.log(
            `  ${f.symbol.padEnd(6)} ${("+" + (f.foreignNetValue / 1e9).toFixed(1) + "B").padStart(8)}  close ${String(f.close).padStart(6)}  ${f.chgPct >= 0 ? "+" : ""}${f.chgPct.toFixed(1)}%`,
        );
    }
    console.log("Top 10 foreign net sell:");
    for (const f of byNet.slice(-10).reverse()) {
        console.log(
            `  ${f.symbol.padEnd(6)} ${((f.foreignNetValue / 1e9).toFixed(1) + "B").padStart(8)}  close ${String(f.close).padStart(6)}  ${f.chgPct >= 0 ? "+" : ""}${f.chgPct.toFixed(1)}%`,
        );
    }

    // Cross-ref: does foreign confirm today's top bandar inflows?
    const ffMap = new Map(flows.map((f) => [f.symbol, f]));
    console.log("\nBandar top-10 vs foreign:");
    for (const s of top10) {
        const f = ffMap.get(s.symbol);
        const fv = f ? f.foreignNetValue / 1e9 : 0;
        const verdict = !f || Math.abs(fv) < 1 ? "neutral" : fv > 0 ? "CONFLUENCE" : "DIVERGENT (foreign selling)";
        console.log(
            `  ${s.symbol.padEnd(6)} bandar ${("+" + (s.delta / 1e9).toFixed(1) + "B").padStart(8)} | foreign ${((fv >= 0 ? "+" : "") + fv.toFixed(1) + "B").padStart(8)}  ${verdict}`,
        );
    }
} else {
    console.log("\n  warn: IDX foreign flow unavailable (blocked or no recent data)");
}

// ─── TOP FLOW CANDLES ───────────────────────────────────────────────────────

console.log("\n" + "━".repeat(70));
console.log(`  CANDLES FOR TOP ${top10.length} DAILY INFLOWS`);
console.log("━".repeat(70));

for (const stock of top10) {
    const candles = await fetchCandles({ symbol: stock.symbol, range: "15d", interval: "1d" });
    if (!candles || candles.length === 0) {
        console.log(`\n${stock.symbol}: no candle data`);
        continue;
    }

    const last = candles[candles.length - 1];
    const last5 = candles.slice(-5);
    const sma5 = last5.reduce((s, c) => s + c.close, 0) / 5;
    const distSma5 = ((last.close - sma5) / sma5) * 100;

    const last10c = candles.slice(-10);
    const avgVol = last10c.reduce((s, c) => s + c.volume, 0) / last10c.length;
    const volRatio = avgVol > 0 ? last.volume / avgVol : 0;

    const range = last.high - last.low;
    const closePos = range > 0 ? ((last.close - last.low) / range) * 100 : 50;

    const chg = ((last.close - last.open) / last.open) * 100;

    console.log(`\n=== ${stock.symbol} | Flow: +${(stock.delta / 1e9).toFixed(1)}B ===`);
    console.log(
        `Close: ${last.close} | Chg: ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}% | MA5: ${sma5.toFixed(0)} (${distSma5 >= 0 ? "+" : ""}${distSma5.toFixed(1)}%) | Vol: ${volRatio.toFixed(2)}x avg | CP: ${closePos.toFixed(0)}%`,
    );

    for (const c of candles.slice(-7)) {
        const d = new Date(c.date * 1000).toISOString().slice(0, 10);
        const cChg = ((c.close - c.open) / c.open * 100).toFixed(2);
        const cp = c.high - c.low > 0 ? ((c.close - c.low) / (c.high - c.low) * 100).toFixed(0) : "50";
        console.log(
            `  ${d} O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${(c.volume / 1e6).toFixed(0)}M ${cChg}% CP:${cp}%`,
        );
    }
}

console.log("\n" + "━".repeat(70));
console.log("  DONE. Apply the Analysis Checklist + regime table from CLAUDE.md");
console.log("━".repeat(70));
