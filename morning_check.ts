/**
 * Morning entry check for BRIS in SIT_OUT regime.
 * Cron fires at 9:30 AM WIB (market opened at 9:00).
 * Uses intraday 5m candles to get today's live open/price.
 * Verdict: ENTER / SKIP / SELL_INTO_GAP
 */
import { fetchCandles } from "./utils/stockbitCandles.ts";

const STOCK = "BRIS";
const YESTERDAY_CLOSE = 1790;
const TP = 1825;
const STOP = 1750;

// ─── Fetch today's intraday ────────────────────────────────
const [ihsg5m, bris5m] = await Promise.all([
    fetchCandles({ symbol: "^JKSE", range: "1d", interval: "5m" }),
    fetchCandles({ symbol: STOCK, range: "1d", interval: "5m" }),
]);

if (!ihsg5m || ihsg5m.length === 0) {
    console.log("SKIP: No IHSG intraday data yet. Token stale or market not open.");
    Deno.exit(0);
}
if (!bris5m || bris5m.length === 0) {
    console.log("SKIP: No BRIS intraday data yet.");
    Deno.exit(0);
}

// Today's open = first candle. Current = last candle.
const ihsgOpen = ihsg5m[0].open;
const ihsgNow = ihsg5m[ihsg5m.length - 1].close;
const ihsgChg = ((ihsgNow - ihsgOpen) / ihsgOpen) * 100;

const brisOpen = bris5m[0].open;
const brisNow = bris5m[bris5m.length - 1].close;
const gapPct = ((brisOpen - YESTERDAY_CLOSE) / YESTERDAY_CLOSE) * 100;

// ─── SIT_OUT Entry Rules ──────────────────────────────────
let verdict: string;
let reason: string;

if (ihsgChg < -1) {
    verdict = "SKIP";
    reason = `IHSG red ${ihsgChg.toFixed(1)}% at 9:30 — >1% threshold. NO ENTRIES.`;
} else if (gapPct > 2) {
    verdict = "SELL_INTO_GAP";
    reason = `BRIS gapped +${gapPct.toFixed(1)}% (open ${brisOpen}). Gap >2% = SELL into it.`;
} else if (gapPct > 1) {
    verdict = "SKIP";
    reason = `BRIS gapped +${gapPct.toFixed(1)}% (open ${brisOpen}). >1% in SIT_OUT = wait.`;
} else if (gapPct < -2) {
    verdict = "SKIP";
    reason = `BRIS gapped DOWN ${gapPct.toFixed(1)}% (open ${brisOpen}). Don't catch falling knife.`;
} else {
    verdict = "ENTER";
    reason = `Conditions met. IHSG ${ihsgChg >= 0 ? "+" : ""}${ihsgChg.toFixed(1)}%, BRIS open ${brisOpen} (gap ${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}%), now ${brisNow}.`;
}

// ─── Output ────────────────────────────────────────────────
const now = new Date();
const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(11, 16);
console.log(`${"=".repeat(55)}`);
console.log(`  BRIS ENTRY CHECK — ${wib} WIB`);
console.log(`${"=".repeat(55)}`);
console.log(`  IHSG: Open ${ihsgOpen.toFixed(0)} → Now ${ihsgNow.toFixed(0)} (${ihsgChg >= 0 ? "+" : ""}${ihsgChg.toFixed(1)}%)`);
console.log(`  BRIS: Open ${brisOpen} → Now ${brisNow} | Gap ${gapPct >= 0 ? "+" : ""}${gapPct.toFixed(1)}% vs yday ${YESTERDAY_CLOSE}`);
console.log(`${"-".repeat(55)}`);
console.log(`  >>> ${verdict} <<<`);
console.log(`  ${reason}`);
if (verdict === "ENTER") {
    console.log(`  Entry: ${brisNow} | TP: ${TP} (+${((TP/brisNow-1)*100).toFixed(1)}%) | Stop: ${STOP} (${((STOP/brisNow-1)*100).toFixed(1)}%)`);
    console.log(`  Half size. Intraday only. Cut by close.`);
}
if (verdict === "SKIP") {
    console.log(`  Next check: tomorrow 9:30 AM WIB`);
}
console.log(`${"=".repeat(55)}`);
