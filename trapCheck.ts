// deno task trap
// Premarket trap probability 0-100: SM flow that looks like accumulation but is really an exit,
// so a bounce fades and traps whoever chased. Shares detectRegime() + the top-inflows list with
// daily/picker; the trap-specific tell is top inflows stretched above MA5 on fading volume.
//   < 55    ENTER  normal regime-table rules apply
//   55..79  WAIT   trade small and late, hard +2% cap
//   >= 80   SKIP   stand aside, the move is a trap
import { detectRegime } from "./market/marketRegime.ts";
import { fetchCandles } from "./data/stockbitCandles.ts";
import { fetchBandarDeltas } from "./data/fetchScreener.ts";
import { distPct, sma } from "./market/indicators.ts";

// Points each signal contributes to the trap probability when it fires.
const WEIGHTS = {
    SIT_OUT: 30,
    AGGRESSIVE: -20,       // a healthy tape lowers trap probability
    DEAD_CAT: 25,
    BREADTH_UNDER_22: 25,
    BREADTH_UNDER_30: 15,
    MA10_FALLING: 20,
    DIST_MA20_DEEP: 15,    // IHSG more than 3% below MA20
    FLOW_EXTENDED: 15,     // top flow avg more than 5% above MA5
    VOLUME_DECLINING: 10,  // volume fading on the bounce
    IHSG_OVERSHOT: 10,     // 3d bounce over 7%
};

console.log("═".repeat(55));
console.log("  PREMARKET TRAP DETECTOR");
console.log("═".repeat(55));

// Regime, breadth, and IHSG structure all come from the shared detector,
// the single source of truth that daily and picker also use.
console.log("\n[1/2] Reading market regime...");
const r = await detectRegime();
const regime = r.regime;
const breadth = r.breadth.ratio * 100;
const { close, chg1d, chg3d, ma5, ma10, ma20, ma10Slope, distMa20 } = r.ihsg;

// Trap specific check: are today's top inflow names already overextended?
// Same delta ranking daily uses (fetchBandarDeltas), so both tools watch the
// same "top inflow" names.
console.log("[2/2] Checking top flow stocks for overextension...");
const topBuyers = (await fetchBandarDeltas())
    .filter(s => s.delta > 0)
    .slice(0, 5);

let totalExtension = 0;
let extCount = 0;
let decliningVol = 0;
for (const stock of topBuyers) {
    const candles = await fetchCandles({ symbol: stock.symbol, range: "15d", interval: "1d" });
    if (!candles || candles.length < 5) continue;

    const last = candles[candles.length - 1];
    totalExtension += distPct(last.close, sma(candles.map(c => c.close), 5));
    extCount++;

    // A bounce on fading volume is a distribution tell.
    const vols = candles.slice(-5).map(c => c.volume);
    if ((vols[vols.length - 1] - vols[0]) / (vols[0] || 1) < 0) decliningVol++;
}
const avgExtension = extCount > 0 ? totalExtension / extCount : 0;
const volFading = extCount > 0 && decliningVol / extCount > 0.5;

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
if (distMa20 < -3 && ma10Slope < 0) {
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

if (distMa20 < -3) {
    probability += WEIGHTS.DIST_MA20_DEEP;
    signals.push(`IHSG ${distMa20.toFixed(1)}% below MA20 (+${WEIGHTS.DIST_MA20_DEEP}%)`);
}

if (avgExtension > 5) {
    probability += WEIGHTS.FLOW_EXTENDED;
    signals.push(`Top flow avg +${avgExtension.toFixed(1)}% above MA5 (+${WEIGHTS.FLOW_EXTENDED}%)`);
}

if (volFading && chg3d > 3) {
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

console.log(`\n  IHSG: ${close.toFixed(0)} | 1d: ${chg1d >= 0 ? "+" : ""}${chg1d.toFixed(1)}% | 3d: ${chg3d >= 0 ? "+" : ""}${chg3d.toFixed(1)}%`);
console.log(`  MA5: ${ma5.toFixed(0)} | MA10: ${ma10.toFixed(0)} | MA20: ${ma20.toFixed(0)}`);
console.log(`  MA10 slope: ${ma10Slope >= 0 ? "+" : ""}${ma10Slope.toFixed(1)}% | Dist MA20: ${distMa20 >= 0 ? "+" : ""}${distMa20.toFixed(1)}%`);
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
