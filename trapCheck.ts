/**
 * Premarket Trap Detector.
 * Run before the open to check whether today's setup is a bandar distribution trap.
 *
 * Usage: deno task trap
 *
 * Output: TRAP PROBABILITY % + ENTER / WAIT / SKIP recommendation.
 *
 * TEMPORARY: remove if unused.  Kel, just say "hapus trap check" and it's gone.
 */

import { fetchCandles } from "./data/stockbitCandles.ts";
import { fetchScreener } from "./data/fetchScreener.ts";
import { ITEMS } from "./data/screenerItems.ts";
import { distPct, maSlope, pctChange, sma } from "./market/indicators.ts";

// ─── Scoring weights ────────────────────────────────────────
const WEIGHTS = {
    SIT_OUT: 30,
    AGGRESSIVE: -20,       // negative weight lowers trap probability
    DEAD_CAT: 25,
    BREADTH_UNDER_22: 25,
    BREADTH_UNDER_30: 15,
    MA10_FALLING: 20,
    DIST_MA20_DEEP: 15,    // IHSG more than 3% below MA20
    FLOW_EXTENDED: 15,     // top flow avg more than 5% above MA5
    VOLUME_DECLINING: 10,  // volume fading on the bounce
    IHSG_OVERSHOT: 10,     // 3d bounce over 7%
};

// ─── Main ────────────────────────────────────────────────────

console.log("═".repeat(55));
console.log("  PREMARKET TRAP DETECTOR");
console.log("═".repeat(55));

// 1. IHSG structure.
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

const ma5 = sma(closes, 5);
const ma10 = sma(closes, 10);
const ma20 = sma(closes, 20);
const ma10Slope = maSlope(closes, 10, 3);
const distMA20 = distPct(today.close, ma20);

const chg1d = pctChange(yesterday.close, today.close);
const chg3d = n >= 4 ? pctChange(ihsg[n - 4].close, today.close) : 0;

// Simplified IHSG only regime.  Breadth is scored separately below, so keep it out here
// to avoid double counting.
let regime = "NORMAL";
if (distMA20 < -3 && ma10Slope < 0) regime = "SIT_OUT";
else if (distMA20 < -3 || ma10Slope < -3) regime = "SIT_OUT";
else if (distMA20 < -1 || ma10Slope < -1) regime = "DEFENSIVE";

// 2. Breadth.
console.log("[2/3] Checking market breadth...");
const [buying, selling] = await Promise.all([
    fetchScreener({ filters: [{ id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 }], page: 1, perPage: 1 }),
    fetchScreener({ filters: [{ id: ITEMS.BANDAR_VALUE, operator: "<", value: 0 }], page: 1, perPage: 1 }),
]);
const breadth = (buying.totalRows + selling.totalRows) > 0
    ? (buying.totalRows / (buying.totalRows + selling.totalRows)) * 100
    : 50;

// 3. Are the top flow stocks already overextended above their MA5?
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

// Rank by today's bandar delta (cumulative minus previous).
const enriched = topFlow.stocks.map(s => ({
    symbol: s.symbol,
    bandar: s.results[ITEMS.BANDAR_VALUE] || 0,
    bandarPrev: s.results[ITEMS.BANDAR_PREV_VALUE] || 0,
}));
enriched.sort((a, b) => (b.bandar - b.bandarPrev) - (a.bandar - a.bandarPrev));

let totalExtension = 0;
let extCount = 0;
let decliningVol = 0;
let volCount = 0;

for (const stock of enriched.filter(s => s.bandar > s.bandarPrev).slice(0, 5)) {
    const candles = await fetchCandles({ symbol: stock.symbol, range: "15d", interval: "1d" });
    if (!candles || candles.length < 5) continue;

    const last = candles[candles.length - 1];
    totalExtension += distPct(last.close, sma(candles.map(c => c.close), 5));
    extCount++;

    // A bounce on fading volume is a distribution tell.
    const vols = candles.slice(-5).map(c => c.volume);
    if ((vols[vols.length - 1] - vols[0]) / (vols[0] || 1) < 0) decliningVol++;
    volCount++;
}

const avgExtension = extCount > 0 ? totalExtension / extCount : 0;

// ─── SCORING ─────────────────────────────────────────────────

let probability = 0;
const signals: string[] = [];

if (regime === "SIT_OUT") {
    probability += WEIGHTS.SIT_OUT;
    signals.push(`SIT_OUT regime (+${WEIGHTS.SIT_OUT}%)`);
} else if (regime === "AGGRESSIVE") {
    probability += WEIGHTS.AGGRESSIVE;
    signals.push(`AGGRESSIVE regime (${WEIGHTS.AGGRESSIVE}%)`);
}

// Dead cat: deep below MA20 while MA10 is still falling.
if (distMA20 < -3 && ma10Slope < 0) {
    probability += WEIGHTS.DEAD_CAT;
    signals.push(`Dead cat bounce (+${WEIGHTS.DEAD_CAT}%)`);
}

if (breadth < 22) {
    probability += WEIGHTS.BREADTH_UNDER_22;
    signals.push(`Breadth ${breadth.toFixed(0)}% < 22% (+${WEIGHTS.BREADTH_UNDER_22}%)`);
} else if (breadth < 30) {
    probability += WEIGHTS.BREADTH_UNDER_30;
    signals.push(`Breadth ${breadth.toFixed(0)}% < 30% (+${WEIGHTS.BREADTH_UNDER_30}%)`);
}

if (ma10Slope < -1) {
    probability += WEIGHTS.MA10_FALLING;
    signals.push(`MA10 falling ${ma10Slope.toFixed(1)}% (+${WEIGHTS.MA10_FALLING}%)`);
}

if (distMA20 < -3) {
    probability += WEIGHTS.DIST_MA20_DEEP;
    signals.push(`IHSG ${distMA20.toFixed(1)}% below MA20 (+${WEIGHTS.DIST_MA20_DEEP}%)`);
}

if (avgExtension > 5) {
    probability += WEIGHTS.FLOW_EXTENDED;
    signals.push(`Top flow avg +${avgExtension.toFixed(1)}% above MA5 (+${WEIGHTS.FLOW_EXTENDED}%)`);
}

if (volCount > 0 && decliningVol / volCount > 0.5 && chg3d > 3) {
    probability += WEIGHTS.VOLUME_DECLINING;
    signals.push(`Vol declining on +${chg3d.toFixed(1)}% bounce (+${WEIGHTS.VOLUME_DECLINING}%)`);
}

if (chg3d > 7) {
    probability += WEIGHTS.IHSG_OVERSHOT;
    signals.push(`IHSG +${chg3d.toFixed(1)}% in 3d (+${WEIGHTS.IHSG_OVERSHOT}%)`);
}

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
console.log(`  Top flow avg extension: ${extCount > 0 ? (avgExtension >= 0 ? "+" : "") + avgExtension.toFixed(1) + "%" : "N/A"}`);

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
    console.log("    Max 1 to 2 picks. Half size. +2% TP hard cap.");
    console.log("    Wait 60min after open. IHSG red at 9:30 = SKIP.");
} else {
    console.log("    Normal entry rules per regime table apply.");
    console.log("    Still verify individual stock setups.");
}

console.log("\n" + "═".repeat(55));
