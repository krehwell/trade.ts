/**
 * Daily analysis script. Run once per session to get all the data needed.
 * Outputs: IHSG regime, full screener scan with daily deltas, candles for top stocks.
 *
 * Usage: deno task daily
 */

import { fetchCandles } from "./data/stockbitCandles.ts";
import { fetchScreener } from "./data/fetchScreener.ts";
import { ITEMS } from "./data/screenerItems.ts";
import { distPct, maSlope, pctChange, sma } from "./market/indicators.ts";
import { detectRegime, printRegime } from "./market/marketRegime.ts";

// ─── IHSG REGIME ────────────────────────────────────────────────────────────

console.log("━".repeat(70));
console.log("  IHSG REGIME CHECK");
console.log("━".repeat(70));

// Authoritative regime — the SAME detector the picker uses (IHSG trend + breadth
// + trap filters). Single source of truth; do not re-derive a separate verdict here.
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
console.log("  BANDAR FLOW SCAN (Top 50 by cumulative, ranked by daily delta)");
console.log("━".repeat(70));

const filters = [
    { id: ITEMS.BANDAR_VALUE, operator: ">" as const, value: 0 },
    { id: ITEMS.BANDAR_PREV_VALUE, operator: "!=" as const, value: 999999999999 },
];

// Fetch page 1 and 2
const page1 = await fetchScreener({ filters, orderCol: ITEMS.BANDAR_VALUE, orderType: "desc", page: 1 });
const page2 = await fetchScreener({ filters, orderCol: ITEMS.BANDAR_VALUE, orderType: "desc", page: 2 });
const allStocks = [...page1.stocks, ...page2.stocks];

// Breadth: count negative bandar stocks
const negPage = await fetchScreener({
    filters: [{ id: ITEMS.BANDAR_VALUE, operator: "<", value: 0 }],
    page: 1,
    perPage: 1,
});
const breadth = ((page1.totalRows / (page1.totalRows + negPage.totalRows)) * 100).toFixed(1);

console.log(
    `Positive bandar: ${page1.totalRows} | Negative: ${negPage.totalRows} | Breadth: ${breadth}%\n`,
);

// Compute daily deltas
const enriched = allStocks.map((s) => {
    const bandar = s.results[ITEMS.BANDAR_VALUE] || 0;
    const bandarPrev = s.results[ITEMS.BANDAR_PREV_VALUE] || 0;
    const delta = bandar - bandarPrev;
    return { symbol: s.symbol, bandar, bandarPrev, delta };
});

// Sort by daily delta
enriched.sort((a, b) => b.delta - a.delta);

console.log("Rank | Ticker | BandarCum  | BandarPrev | DailyDelta");
console.log("-".repeat(60));
for (let i = 0; i < enriched.length; i++) {
    const s = enriched[i];
    const sign = s.delta >= 0 ? "+" : "";
    console.log(
        `${String(i + 1).padStart(2)}   | ${s.symbol.padEnd(6)} | ${(s.bandar / 1e9).toFixed(1).padStart(9)}B | ${(s.bandarPrev / 1e9).toFixed(1).padStart(9)}B | ${sign}${(s.delta / 1e9).toFixed(1).padStart(7)}B`,
    );
}

// ─── TOP FLOW CANDLES ───────────────────────────────────────────────────────

const top10 = enriched.filter((s) => s.delta > 0).slice(0, 10);

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
console.log("  DONE — Analyze above data and apply Phase 4-5 from MEMORY.md");
console.log("━".repeat(70));
