/**
 * Pre-Market Trap Detector
 * Run before market opens to check if today's setup is a bandar distribution trap.
 *
 * Usage: deno task trap
 * 
 * Output: TRAP PROBABILITY % + ENTER / WAIT / SKIP recommendation.
 *
 * ⚠ TEMPORARY — remove if unused. Kel, just say "hapus trap check" and it's gone.
 */

import { fetchCandles } from "./utils/yahooFetch.ts";
import { fetchScreener } from "./fetchScreener.ts";
import { ITEMS } from "./utils/screenerItems.ts";

// ─── Scoring weights ────────────────────────────────────────
const WEIGHTS = {
    SIT_OUT: 30,
    AGGRESSIVE: -20,       // negative = reduces trap probability
    DEAD_CAT: 25,
    BREADTH_UNDER_22: 25,
    BREADTH_UNDER_30: 15,
    MA10_FALLING: 20,
    DIST_MA20_DEEP: 15,    // below MA20 >3%
    FLOW_EXTENDED: 15,     // avg top flow >5% above MA5
    VOLUME_DECLINING: 10,  // volume declining on bounce
    IHSG_OVERSHOT: 10,     // 3d bounce >7%
};

interface TrapResult {
    probability: number;
    verdict: "ENTER" | "WAIT" | "SKIP";
    signals: string[];
    details: Record<string, string>;
}

// ─── Main ────────────────────────────────────────────────────

console.log("═".repeat(55));
console.log("  PRE-MARKET TRAP DETECTOR");
console.log("═".repeat(55));

// 1. IHSG Regime
console.log("\n[1/3] Checking IHSG structure...");
const ihsg = await fetchCandles({ symbol: "^JKSE", range: "60d", interval: "1d" });
if (!ihsg || ihsg.length < 20) {
    console.log("ERROR: No IHSG data");
    Deno.exit(1);
}

const closes = ihsg.map(c => c.close);
const n = closes.length;
const today = ihsg[n - 1];
const yesterday = ihsg[n - 2];

const ma5 = closes.slice(-5).reduce((s, v) => s + v, 0) / 5;
const ma10 = closes.slice(-10).reduce((s, v) => s + v, 0) / 10;
const ma20 = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;

const ma5_3dAgo = closes.slice(0, -3).slice(-5).reduce((s, v) => s + v, 0) / 5;
const ma10_3dAgo = closes.slice(0, -3).slice(-10).reduce((s, v) => s + v, 0) / 10;

const ma5Slope = ma5_3dAgo > 0 ? ((ma5 - ma5_3dAgo) / ma5_3dAgo) * 100 : 0;
const ma10Slope = ma10_3dAgo > 0 ? ((ma10 - ma10_3dAgo) / ma10_3dAgo) * 100 : 0;
const distMA20 = ((today.close - ma20) / ma20) * 100;

const chg1d = ((today.close - yesterday.close) / yesterday.close) * 100;
const chg3d = n >= 4 ? ((today.close - ihsg[n - 4].close) / ihsg[n - 4].close) * 100 : 0;
const chg5d = n >= 6 ? ((today.close - ihsg[n - 6].close) / ihsg[n - 6].close) * 100 : 0;

let regime = "NORMAL";
if (distMA20 < -3 && ma10Slope < 0) regime = "SIT_OUT";
else if (distMA20 < -3 || ma10Slope < -3) regime = "SIT_OUT";
else if (distMA20 < -1 || ma10Slope < -1) regime = "DEFENSIVE";

// IHSG volume trend
const volsLast5 = ihsg.slice(-5).map(c => c.volume);
const volTrend = volsLast5.length >= 3
    ? (volsLast5[volsLast5.length - 1] - volsLast5[0]) / (volsLast5[0] || 1)
    : 0;

// 2. Breadth
console.log("[2/3] Checking market breadth...");
const [buying, selling] = await Promise.all([
    fetchScreener({ filters: [{ id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 }], page: 1, perPage: 1 }),
    fetchScreener({ filters: [{ id: ITEMS.BANDAR_VALUE, operator: "<", value: 0 }], page: 1, perPage: 1 }),
]);
const breadth = (buying.totalRows + selling.totalRows) > 0
    ? (buying.totalRows / (buying.totalRows + selling.totalRows)) * 100
    : 50;

// 3. Top flow extension check
console.log("[3/3] Checking top flow stocks for overextension...");
const topFlow = await fetchScreener({
    filters: [
        { id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 },
        { id: ITEMS.BANDAR_PREV_VALUE, operator: "!=", value: 999999999 },
    ],
    orderCol: ITEMS.BANDAR_VALUE,
    orderType: "desc",
    page: 1,
    perPage: 10,
});

// Compute daily deltas for top stocks
const enriched = topFlow.stocks.map(s => ({
    symbol: s.symbol,
    bandar: s.results[ITEMS.BANDAR_VALUE] || 0,
    bandarPrev: s.results[ITEMS.BANDAR_PREV_VALUE] || 0,
}));
enriched.sort((a, b) => (b.bandar - b.bandarPrev) - (a.bandar - a.bandarPrev));

// Get candles for positive delta stocks
let totalExtension = 0;
let extCount = 0;
let decliningVol = 0;
let volCount = 0;

for (const stock of enriched.filter(s => s.bandar > s.bandarPrev).slice(0, 5)) {
    const candles = await fetchCandles({ symbol: stock.symbol, range: "15d", interval: "1d" });
    if (!candles || candles.length < 5) continue;

    const last5 = candles.slice(-5);
    const sma5 = last5.reduce((s, c) => s + c.close, 0) / 5;
    const ext = ((last5[last5.length - 1].close - sma5) / sma5) * 100;
    totalExtension += ext;
    extCount++;

    // Volume trend
    const vols = candles.slice(-5).map(c => c.volume);
    const vTrend = (vols[vols.length - 1] - vols[0]) / (vols[0] || 1);
    if (vTrend < 0) decliningVol++;
    volCount++;
}

const avgExtension = extCount > 0 ? totalExtension / extCount : 0;

// ─── SCORING ─────────────────────────────────────────────────

let probability = 0;
const signals: string[] = [];
const details: Record<string, string> = {};

// Regime-based
if (regime === "SIT_OUT") {
    probability += WEIGHTS.SIT_OUT;
    signals.push(`SIT_OUT regime (+${WEIGHTS.SIT_OUT}%)`);
    details["Regime"] = `SIT_OUT — market hostile`;
} else if (regime === "AGGRESSIVE") {
    probability += WEIGHTS.AGGRESSIVE;
    signals.push(`AGGRESSIVE regime (${WEIGHTS.AGGRESSIVE}%)`);
    details["Regime"] = `AGGRESSIVE — reduced trap risk`;
} else {
    details["Regime"] = `${regime} — neutral`;
}

// Dead cat trap
if (distMA20 < -3 && ma10Slope < 0) {
    probability += WEIGHTS.DEAD_CAT;
    signals.push(`Dead cat bounce (+${WEIGHTS.DEAD_CAT}%)`);
    details["Dead Cat"] = `distMA20 ${distMA20.toFixed(1)}% + MA10 slope ${ma10Slope.toFixed(1)}%`;
}

// Breadth
if (breadth < 22) {
    probability += WEIGHTS.BREADTH_UNDER_22;
    signals.push(`Breadth ${breadth.toFixed(0)}% < 22% (+${WEIGHTS.BREADTH_UNDER_22}%)`);
    details["Breadth"] = `${breadth.toFixed(0)}% — hostile`;
} else if (breadth < 30) {
    probability += WEIGHTS.BREADTH_UNDER_30;
    signals.push(`Breadth ${breadth.toFixed(0)}% < 30% (+${WEIGHTS.BREADTH_UNDER_30}%)`);
    details["Breadth"] = `${breadth.toFixed(0)}% — weak`;
} else {
    details["Breadth"] = `${breadth.toFixed(0)}% — healthy`;
}

// MA10 falling
if (ma10Slope < -1) {
    probability += WEIGHTS.MA10_FALLING;
    signals.push(`MA10 falling ${ma10Slope.toFixed(1)}% (+${WEIGHTS.MA10_FALLING}%)`);
    details["MA10"] = `slope ${ma10Slope.toFixed(1)}% — declining`;
}

// Distance from MA20
if (distMA20 < -3) {
    probability += WEIGHTS.DIST_MA20_DEEP;
    signals.push(`IHSG ${distMA20.toFixed(1)}% below MA20 (+${WEIGHTS.DIST_MA20_DEEP}%)`);
}

// Top flow overextension
if (avgExtension > 5) {
    probability += WEIGHTS.FLOW_EXTENDED;
    signals.push(`Top flow avg +${avgExtension.toFixed(1)}% above MA5 (+${WEIGHTS.FLOW_EXTENDED}%)`);
    details["Extension"] = `avg +${avgExtension.toFixed(1)}% above MA5`;
}

// Volume declining on bounce
if (volCount > 0 && decliningVol / volCount > 0.5 && chg3d > 3) {
    probability += WEIGHTS.VOLUME_DECLINING;
    signals.push(`Vol declining on +${chg3d.toFixed(1)}% bounce (+${WEIGHTS.VOLUME_DECLINING}%)`);
    details["Volume"] = `${decliningVol}/${volCount} top stocks vol declining`;
}

// IHSG 3d overshoot
if (chg3d > 7) {
    probability += WEIGHTS.IHSG_OVERSHOT;
    signals.push(`IHSG +${chg3d.toFixed(1)}% in 3d (+${WEIGHTS.IHSG_OVERSHOT}%)`);
}

// Clamp
probability = Math.min(100, Math.max(0, probability));

// ─── VERDICT ──────────────────────────────────────────────────

const verdict = probability >= 80 ? "SKIP"
    : probability >= 55 ? "WAIT"
    : "ENTER";

const verdictColors: Record<string, string> = {
    SKIP: "\x1b[41m\x1b[37m",
    WAIT: "\x1b[43m\x1b[30m",
    ENTER: "\x1b[42m\x1b[30m",
};
const reset = "\x1b[0m";

// ─── OUTPUT ───────────────────────────────────────────────────

console.log("\n" + "═".repeat(55));
console.log("  TRAP DETECTION RESULT");
console.log("═".repeat(55));

console.log(`\n  IHSG: ${today.close.toFixed(0)} | 1d: ${chg1d >= 0 ? "+" : ""}${chg1d.toFixed(1)}% | 3d: ${chg3d >= 0 ? "+" : ""}${chg3d.toFixed(1)}%`);
console.log(`  MA5: ${ma5.toFixed(0)} | MA10: ${ma10.toFixed(0)} | MA20: ${ma20.toFixed(0)}`);
console.log(`  MA10 slope: ${ma10Slope >= 0 ? "+" : ""}${ma10Slope.toFixed(1)}% | Dist MA20: ${distMA20 >= 0 ? "+" : ""}${distMA20.toFixed(1)}%`);
console.log(`  Regime: ${regime} | Breadth: ${breadth.toFixed(0)}%`);
console.log(`  Top flow avg extension: ${extCount > 0 ? "+" + avgExtension.toFixed(1) + "%" : "N/A"}`);

console.log(`\n  ┌─────────────────────────────────────┐`);
console.log(`  │  TRAP PROBABILITY: ${String(probability).padStart(3)}%              │`);
console.log(`  │  VERDICT: ${verdictColors[verdict]} ${verdict} ${reset}                       │`);
console.log(`  └─────────────────────────────────────┘`);

console.log("\n  Signals:");
for (const s of signals) {
    console.log(`    ▸ ${s}`);
}

console.log("\n  Rules:");
if (verdict === "SKIP") {
    console.log("    NO ENTRIES today. Market is a distribution trap.");
    console.log("    If you MUST trade: 1 pick max, quarter size, +1.5% TP only.");
} else if (verdict === "WAIT") {
    console.log("    Max 1-2 picks. Half size. +2% TP hard cap.");
    console.log("    Wait 60min after open. IHSG red at 9:30 = SKIP.");
} else {
    console.log("    Normal entry rules per regime table apply.");
    console.log("    Still verify individual stock setups.");
}

console.log("\n" + "═".repeat(55));
