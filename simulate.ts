/**
 * Backtest simulation: What would the regime detector + analyzer have said
 * on each of our 3 pick sessions?
 *
 * Session 1: Apr 21 (buy afternoon) → sell Apr 22
 * Session 2: Apr 22 (buy afternoon) → sell Apr 23
 * Session 3: Apr 23 (buy afternoon) → sell Apr 24
 */

import { fetchYahooDaily, fetchYahooDailyMulti } from "./utils/yahooFetch.ts";
import { printHeader, printSubHeader } from "./utils/print.ts";

const sma = (values: number[], period: number): number => {
    if (values.length < period) return NaN;
    const slice = values.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / period;
};

interface SessionPick {
    symbol: string;
    entry?: number;  // will be filled from candles
    exit?: number;
    pnl?: number;
}

const SESSIONS = [
    {
        date: "2026-04-21",
        sellDate: "2026-04-22",
        label: "Session 1",
        picks: [
            { symbol: "LPPF" },
            { symbol: "MNCN" },
            { symbol: "PTPS" },
            { symbol: "SGRO" },
            { symbol: "ESSA" },
        ] as SessionPick[],
    },
    {
        date: "2026-04-22",
        sellDate: "2026-04-23",
        label: "Session 2",
        picks: [
            { symbol: "TBLA" },
            { symbol: "BMTR" },
            { symbol: "DMAS" },
            { symbol: "LPPF" },
            { symbol: "ESSA" },
            { symbol: "OMED" },
            { symbol: "PYFA" },
        ] as SessionPick[],
    },
    {
        date: "2026-04-23",
        sellDate: "2026-04-24",
        label: "Session 3",
        picks: [
            { symbol: "ENRG" },
            { symbol: "ELSA" },
            { symbol: "UNIQ" },
            { symbol: "MDLN" },
            { symbol: "MMIX" },
            { symbol: "BIPI" },
            { symbol: "WOOD" },
        ] as SessionPick[],
    },
];

async function main() {
    printHeader("REGIME BACKTEST SIMULATION");

    // Fetch IHSG candles (60 days to have enough history for MAs)
    console.log("  Fetching IHSG candles...");
    const ihsgCandles = await fetchYahooDaily({ symbol: "^JKSE", days: 60 });
    console.log(`  Got ${ihsgCandles.length} IHSG candles (${ihsgCandles[0]?.date} to ${ihsgCandles[ihsgCandles.length - 1]?.date})`);

    // Fetch all pick candles
    const allSymbols = [...new Set(SESSIONS.flatMap(s => s.picks.map(p => p.symbol)))];
    console.log(`  Fetching candles for ${allSymbols.length} stocks...`);
    const stockCandles = await fetchYahooDailyMulti({ symbols: allSymbols, days: 60 });

    // For each session, simulate the regime
    for (const session of SESSIONS) {
        printSubHeader(`${session.label}: ${session.date} → ${session.sellDate}`);

        // Find the IHSG candle index for this date
        const dateIdx = ihsgCandles.findIndex(c => c.date === session.date);
        if (dateIdx < 0) {
            console.log(`  ERROR: No IHSG candle for ${session.date}`);
            // Try to find closest
            console.log(`  Available dates: ${ihsgCandles.map(c => c.date).join(", ")}`);
            continue;
        }

        // Compute IHSG signals as of that date
        const closes = ihsgCandles.slice(0, dateIdx + 1).map(c => c.close);
        const t = ihsgCandles[dateIdx];
        const y = ihsgCandles[dateIdx - 1];
        const d3ago = dateIdx >= 3 ? ihsgCandles[dateIdx - 3] : null;
        const d5ago = dateIdx >= 5 ? ihsgCandles[dateIdx - 5] : null;

        const chg1d = (t.close - y.close) / y.close * 100;
        const chg3d = d3ago ? (t.close - d3ago.close) / d3ago.close * 100 : 0;
        const chg5d = d5ago ? (t.close - d5ago.close) / d5ago.close * 100 : 0;

        const ma5 = sma(closes, 5);
        const ma10 = sma(closes, 10);
        const ma20 = sma(closes, 20);

        const aboveMa5 = t.close > ma5;
        const aboveMa10 = t.close > ma10;
        const aboveMa20 = t.close > ma20;

        // MA5 slope
        const closes3dAgo = closes.slice(0, -3);
        const ma5_3dAgo = sma(closes3dAgo, 5);
        const ma5Slope = !isNaN(ma5_3dAgo) && ma5_3dAgo > 0 ? (ma5 - ma5_3dAgo) / ma5_3dAgo * 100 : 0;

        // Score (IHSG-only portion — no breadth data available historically)
        let ihsgScore = 0;
        const signals: string[] = [];

        if (chg1d > 0.5) { ihsgScore += 2; signals.push(`IHSG +${chg1d.toFixed(1)}%`); }
        else if (chg1d > 0) { ihsgScore += 1; signals.push(`IHSG +${chg1d.toFixed(1)}%`); }
        else if (chg1d > -0.5) { ihsgScore -= 1; signals.push(`IHSG ${chg1d.toFixed(1)}%`); }
        else if (chg1d > -1.5) { ihsgScore -= 2; signals.push(`IHSG ${chg1d.toFixed(1)}% WEAK`); }
        else { ihsgScore -= 3; signals.push(`IHSG ${chg1d.toFixed(1)}% SELLOFF`); }

        if (chg3d > 1) { ihsgScore += 1; signals.push("3d UP"); }
        else if (chg3d < -1) { ihsgScore -= 1; signals.push("3d DOWN"); }

        if (chg5d > 2) { ihsgScore += 1; signals.push("5d UP"); }
        else if (chg5d < -2) { ihsgScore -= 1; signals.push("5d DOWN"); }

        if (aboveMa5 && aboveMa10 && aboveMa20) { ihsgScore += 2; signals.push("above all MAs"); }
        else if (!aboveMa5 && !aboveMa10 && !aboveMa20) { ihsgScore -= 2; signals.push("below all MAs"); }
        else if (aboveMa20 && !aboveMa5) { ihsgScore -= 1; signals.push("pulling back"); }

        if (ma5Slope > 0.3) { ihsgScore += 1; signals.push("MA5 rising"); }
        else if (ma5Slope < -0.3) { ihsgScore -= 1; signals.push("MA5 falling"); }

        // Estimate regime (IHSG-only, breadth would add -2 to +2 more)
        let estimatedRegime: string;
        if (ihsgScore >= 4) estimatedRegime = "AGGRESSIVE";
        else if (ihsgScore >= 1) estimatedRegime = "NORMAL";
        else if (ihsgScore >= -2) estimatedRegime = "DEFENSIVE";
        else estimatedRegime = "SIT_OUT";

        console.log(`  IHSG: ${t.close.toFixed(0)} | 1d: ${chg1d >= 0 ? "+" : ""}${chg1d.toFixed(2)}% | 3d: ${chg3d >= 0 ? "+" : ""}${chg3d.toFixed(2)}% | 5d: ${chg5d >= 0 ? "+" : ""}${chg5d.toFixed(2)}%`);
        console.log(`  MA5: ${ma5.toFixed(0)} ${aboveMa5 ? "ABOVE" : "BELOW"} | MA10: ${ma10.toFixed(0)} ${aboveMa10 ? "ABOVE" : "BELOW"} | MA20: ${ma20.toFixed(0)} ${aboveMa20 ? "ABOVE" : "BELOW"}`);
        console.log(`  MA5 slope: ${ma5Slope >= 0 ? "+" : ""}${ma5Slope.toFixed(2)}%`);
        console.log(`  IHSG-only score: ${ihsgScore} | Signals: ${signals.join(", ")}`);
        console.log(`  Estimated regime (IHSG only, no breadth): ${estimatedRegime}`);
        console.log(`  (With breadth, score would shift by roughly -2 to +2)`);
        console.log();

        // Now compute actual P&L for each pick
        console.log("  ACTUAL RESULTS:");
        let totalPnl = 0;
        let wins = 0;
        let losses = 0;

        for (const pick of session.picks) {
            const candles = stockCandles[pick.symbol];
            if (!candles || candles.length < 5) {
                console.log(`    ${pick.symbol}: NO DATA`);
                continue;
            }

            // Find buy-day and sell-day candles
            const buyCandle = candles.find(c => c.date === session.date);
            const sellCandle = candles.find(c => c.date === session.sellDate);

            if (!buyCandle || !sellCandle) {
                // Try closest dates
                console.log(`    ${pick.symbol}: Missing candle for ${session.date} or ${session.sellDate}`);
                console.log(`      Available: ${candles.slice(-10).map(c => c.date).join(", ")}`);
                continue;
            }

            // Entry = buy-day close (afternoon buy), Exit = sell-day close
            const entry = buyCandle.close;
            const exit = sellCandle.close;
            const pnl = (exit - entry) / entry * 100;

            pick.entry = entry;
            pick.exit = exit;
            pick.pnl = pnl;

            totalPnl += pnl;
            if (pnl > 0) wins++;
            else losses++;

            const marker = pnl > 0 ? "\x1b[32mW\x1b[0m" : pnl < -1 ? "\x1b[31mL\x1b[0m" : "\x1b[33m~\x1b[0m";
            console.log(`    ${marker} ${pick.symbol.padEnd(6)} | Entry: ${entry} → Exit: ${exit} | ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`);
        }

        const validPicks = session.picks.filter(p => p.pnl !== undefined);
        const avgPnl = validPicks.length > 0 ? totalPnl / validPicks.length : 0;
        console.log(`\n  Summary: W${wins}:L${losses} | Avg: ${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}% | Total: ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`);

        // Verdict
        console.log();
        if (estimatedRegime === "SIT_OUT") {
            console.log("  VERDICT: Regime detector would have BLOCKED all trades");
            console.log(`  Saved: ${Math.abs(totalPnl).toFixed(2)}% in losses avoided`);
        } else if (estimatedRegime === "DEFENSIVE") {
            console.log("  VERDICT: Regime would have limited to 3 picks, half size");
            const top3Pnl = validPicks.slice(0, 3).reduce((s, p) => s + (p.pnl ?? 0), 0) / Math.min(3, validPicks.length);
            console.log(`  Top 3 only avg: ${top3Pnl >= 0 ? "+" : ""}${top3Pnl.toFixed(2)}% (half size = ${(top3Pnl / 2).toFixed(2)}% effective)`);
        } else if (estimatedRegime === "NORMAL") {
            console.log("  VERDICT: Regime would have allowed trades (NORMAL mode)");
        } else {
            console.log("  VERDICT: Regime would have said AGGRESSIVE — full allocation");
        }
        console.log();
    }

    // Grand summary
    printSubHeader("GRAND SUMMARY — Regime Impact");
    const allPicks = SESSIONS.flatMap(s => s.picks.filter(p => p.pnl !== undefined));
    const grandTotal = allPicks.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const grandAvg = allPicks.length > 0 ? grandTotal / allPicks.length : 0;
    const grandWins = allPicks.filter(p => (p.pnl ?? 0) > 0).length;
    const grandLosses = allPicks.filter(p => (p.pnl ?? 0) <= 0).length;

    console.log(`  Without regime: ${allPicks.length} trades | W${grandWins}:L${grandLosses} | Avg: ${grandAvg.toFixed(2)}% | Total: ${grandTotal.toFixed(2)}%`);

    // Compute what would have happened WITH regime
    // We need to check each session's regime and filter accordingly
    let regimePicks: { pnl: number }[] = [];
    for (const session of SESSIONS) {
        const dateIdx = ihsgCandles.findIndex(c => c.date === session.date);
        if (dateIdx < 0) continue;
        const closes = ihsgCandles.slice(0, dateIdx + 1).map(c => c.close);
        const t = ihsgCandles[dateIdx];
        const y = ihsgCandles[dateIdx - 1];
        const d3ago = dateIdx >= 3 ? ihsgCandles[dateIdx - 3] : null;
        const d5ago = dateIdx >= 5 ? ihsgCandles[dateIdx - 5] : null;

        const chg1d = (t.close - y.close) / y.close * 100;
        const chg3d = d3ago ? (t.close - d3ago.close) / d3ago.close * 100 : 0;
        const chg5d = d5ago ? (t.close - d5ago.close) / d5ago.close * 100 : 0;
        const ma5 = sma(closes, 5);
        const ma10 = sma(closes, 10);
        const ma20 = sma(closes, 20);
        const aboveMa5 = t.close > ma5;
        const aboveMa10 = t.close > ma10;
        const aboveMa20 = t.close > ma20;
        const closes3dAgo = closes.slice(0, -3);
        const ma5_3dAgo = sma(closes3dAgo, 5);
        const ma5Slope = !isNaN(ma5_3dAgo) && ma5_3dAgo > 0 ? (ma5 - ma5_3dAgo) / ma5_3dAgo * 100 : 0;

        let score = 0;
        if (chg1d > 0.5) score += 2;
        else if (chg1d > 0) score += 1;
        else if (chg1d > -0.5) score -= 1;
        else if (chg1d > -1.5) score -= 2;
        else score -= 3;
        if (chg3d > 1) score += 1; else if (chg3d < -1) score -= 1;
        if (chg5d > 2) score += 1; else if (chg5d < -2) score -= 1;
        if (aboveMa5 && aboveMa10 && aboveMa20) score += 2;
        else if (!aboveMa5 && !aboveMa10 && !aboveMa20) score -= 2;
        else if (aboveMa20 && !aboveMa5) score -= 1;
        if (ma5Slope > 0.3) score += 1; else if (ma5Slope < -0.3) score -= 1;

        let regime: string;
        if (score >= 4) regime = "AGGRESSIVE";
        else if (score >= 1) regime = "NORMAL";
        else if (score >= -2) regime = "DEFENSIVE";
        else regime = "SIT_OUT";

        const validPicks = session.picks.filter(p => p.pnl !== undefined);
        if (regime === "SIT_OUT") {
            // No trades
        } else if (regime === "DEFENSIVE") {
            // Top 3 picks, half size
            for (const p of validPicks.slice(0, 3)) {
                regimePicks.push({ pnl: (p.pnl ?? 0) / 2 });
            }
        } else if (regime === "NORMAL") {
            // Top 7
            for (const p of validPicks.slice(0, 7)) {
                regimePicks.push({ pnl: p.pnl ?? 0 });
            }
        } else {
            // All picks
            for (const p of validPicks) {
                regimePicks.push({ pnl: p.pnl ?? 0 });
            }
        }
    }

    const regimeTotal = regimePicks.reduce((s, p) => s + p.pnl, 0);
    const regimeAvg = regimePicks.length > 0 ? regimeTotal / regimePicks.length : 0;
    const regimeWins = regimePicks.filter(p => p.pnl > 0).length;
    const regimeLosses = regimePicks.filter(p => p.pnl <= 0).length;

    console.log(`  With regime:    ${regimePicks.length} trades | W${regimeWins}:L${regimeLosses} | Avg: ${regimeAvg.toFixed(2)}% | Total: ${regimeTotal.toFixed(2)}%`);
    console.log();
    console.log(`  Improvement: ${(regimeTotal - grandTotal).toFixed(2)}% saved`);
}

main();
