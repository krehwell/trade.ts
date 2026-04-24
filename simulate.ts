/**
 * 30-day backtest: regime detector + gated scorer
 *
 * Generates sessions from last 30 trading days of IHSG candles.
 * Each session = buy at day N close, sell at day N+1 close.
 *
 * Limitations (no historical screener data):
 * - Regime scoring: IHSG trend/MA only, no breadth
 * - Foundation gates: SM broker flow + price action, no bandar screener
 *
 * Includes counterfactual analysis: what would SIT_OUT days have cost/saved.
 */

import { fetchYahooDaily, fetchYahooDailyMulti, type YahooCandle } from "./utils/yahooFetch.ts";
import { fetchBrokerActivity, fetchTopBrokers } from "./fetchBrokerActivity.ts";
import { printHeader, printSubHeader, fmtNum } from "./utils/print.ts";

const sma = (values: number[], period: number): number => {
    if (values.length < period) return NaN;
    const slice = values.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / period;
};

const SM_BROKERS = ["MS", "BK", "CS", "CG", "GW", "KZ", "RX", "DP", "AK", "ZP", "LG", "TP", "KI", "HP"];

// ═══════════════════════════════════════════════════════════
// REGIME SCORING (IHSG-only, no breadth — not available historically)
// ═══════════════════════════════════════════════════════════

function computeRegimeScore(ihsgCandles: YahooCandle[], dateIdx: number): { score: number; regime: string; signals: string[] } {
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
    const ma10_3dAgo = sma(closes3dAgo, 10);
    const ma5Slope = !isNaN(ma5_3dAgo) && ma5_3dAgo > 0 ? (ma5 - ma5_3dAgo) / ma5_3dAgo * 100 : 0;
    const ma10Slope = !isNaN(ma10_3dAgo) && ma10_3dAgo > 0 ? (ma10 - ma10_3dAgo) / ma10_3dAgo * 100 : 0;
    const distMa20 = !isNaN(ma20) && ma20 > 0 ? (t.close - ma20) / ma20 * 100 : 0;
    const chg10d = dateIdx >= 10 ? (t.close - ihsgCandles[dateIdx - 10].close) / ihsgCandles[dateIdx - 10].close * 100 : 0;

    let score = 0;
    const signals: string[] = [];

    if (chg1d > 0.5) { score += 2; signals.push(`+${chg1d.toFixed(1)}%`); }
    else if (chg1d > 0) { score += 1; signals.push(`+${chg1d.toFixed(1)}%`); }
    else if (chg1d > -0.5) { score -= 1; signals.push(`${chg1d.toFixed(1)}%`); }
    else if (chg1d > -1.5) { score -= 2; signals.push(`${chg1d.toFixed(1)}%`); }
    else { score -= 3; signals.push(`${chg1d.toFixed(1)}% SELL`); }

    if (chg3d > 1) { score += 1; signals.push("3d↑"); }
    else if (chg3d < -1) { score -= 1; signals.push("3d↓"); }
    if (chg5d > 2) { score += 1; signals.push("5d↑"); }
    else if (chg5d < -2) { score -= 1; signals.push("5d↓"); }

    if (aboveMa5 && aboveMa10 && aboveMa20) { score += 2; signals.push(">MAs"); }
    else if (!aboveMa5 && !aboveMa10 && !aboveMa20) { score -= 2; signals.push("<MAs"); }
    else if (aboveMa20 && !aboveMa5) { score -= 1; signals.push("pullback"); }

    if (ma5Slope > 0.3) { score += 1; signals.push("MA5↑"); }
    else if (ma5Slope < -0.3) { score -= 1; signals.push("MA5↓"); }

    let regime: string;
    if (score >= 4) regime = "AGGRESSIVE";
    else if (score >= 1) regime = "NORMAL";
    else if (score >= -2) regime = "DEFENSIVE";
    else regime = "SIT_OUT";

    // TRAP FILTER 1: dead cat bounce — price deep below MA20 + MA10 still falling
    if (distMa20 < -3 && ma10Slope < 0 && regime !== "SIT_OUT") {
        signals.push("TRAP:deadcat");
        regime = "SIT_OUT";
    }

    // TRAP FILTER 2: exhaustion — big 10d run + negative day = topping
    if (chg10d > 7 && chg1d < 0 && regime !== "SIT_OUT") {
        signals.push("TRAP:exhaust");
        regime = "DEFENSIVE";
    }

    return { score, regime, signals };
}

// ═══════════════════════════════════════════════════════════
// GATED SCORING
// ═══════════════════════════════════════════════════════════

interface GatedResult {
    symbol: string;
    grade: string;
    foundation: string[];
    confirmations: string[];
    contradictions: string[];
    price: number;
    chg1d: number;
    chg5d: number;
    volRatio5: number;
    smFlow1d: number;
    smFlow1w: number;
    nextDayPnl: number;
}

function applyGatedScoring({
    sym, candles, dateIdx, smFlow1d, smFlow1w, retailFlow1w,
}: {
    sym: string;
    candles: YahooCandle[];
    dateIdx: number;
    smFlow1d: number;
    smFlow1w: number;
    retailFlow1w: number;
}): Omit<GatedResult, "nextDayPnl"> | null {
    if (dateIdx < 10 || dateIdx >= candles.length - 1) return null;

    const t = candles[dateIdx];
    const y = candles[dateIdx - 1];
    const todayRange = t.high - t.low;
    if (todayRange === 0) return null;

    const chg1d = (t.close - y.close) / y.close * 100;
    const chg3d = dateIdx >= 3 ? (t.close - candles[dateIdx - 3].close) / candles[dateIdx - 3].close * 100 : 0;
    const chg5d = dateIdx >= 5 ? (t.close - candles[dateIdx - 5].close) / candles[dateIdx - 5].close * 100 : 0;

    const prevVols = candles.slice(dateIdx - 5, dateIdx).map(c => c.volume);
    const avgVol5 = prevVols.reduce((s, v) => s + v, 0) / prevVols.length;
    const volRatio5 = avgVol5 > 0 ? t.volume / avgVol5 : 1;

    const vols5 = candles.slice(dateIdx - 4, dateIdx + 1).map(c => c.volume);
    const volTrend = vols5.length >= 2 ? (vols5[vols5.length - 1] - vols5[0]) / (vols5[0] || 1) : 0;

    const closedNearHigh = (t.close - t.low) / todayRange > 0.7;
    const closedNearLow = (t.close - t.low) / todayRange < 0.3;
    const gapUp = t.open > y.close;
    const higher_lows_3d = dateIdx >= 2 &&
        candles[dateIdx].low >= candles[dateIdx - 1].low &&
        candles[dateIdx - 1].low >= candles[dateIdx - 2].low;

    // FOUNDATION
    const foundation: string[] = [];
    if (smFlow1w > 0) foundation.push("SM1w+");
    if (smFlow1d > 0 && smFlow1w > 0) foundation.push("SM aligned");
    if (chg1d > 1 && volRatio5 > 1.5 && closedNearHigh) foundation.push("priceAction");
    if (foundation.length === 0) return null;

    // CONFIRMATIONS
    const confirmations: string[] = [];
    if (volRatio5 > 1.5 && closedNearHigh) confirmations.push(`vol${volRatio5.toFixed(1)}x+hi`);
    if (volRatio5 > 2.0 && volTrend > 0) confirmations.push(`vol${volRatio5.toFixed(1)}x+exp`);
    if (smFlow1d > 0 && chg1d > 0) confirmations.push("SM+price");
    if (chg1d > 2 && volRatio5 > 1.5) confirmations.push(`+${chg1d.toFixed(1)}%+vol`);
    if (retailFlow1w < 0 && smFlow1w > 0) confirmations.push("retailDiv");
    if (higher_lows_3d && closedNearHigh) confirmations.push("struct+");
    if (chg3d > 3 && smFlow1w > 0) confirmations.push("mom+SM");
    if (chg1d > 0 && volTrend > 0.5) confirmations.push("volExp");

    // CONTRADICTIONS
    const contradictions: string[] = [];
    if (volRatio5 > 2.0 && closedNearLow) contradictions.push("hiVol+lo");
    if (smFlow1d > 0 && smFlow1w < 0) contradictions.push("SM1d+vs1w-");
    if (chg1d > 2 && volRatio5 < 0.8) contradictions.push("price↑vol☠");
    if (chg5d > 15 && closedNearLow && chg1d < 0) contradictions.push("exhaust");
    if (gapUp && chg1d < -1) contradictions.push("gapReject");
    if (chg3d > 5 && volTrend < -0.3) contradictions.push("price↑volFade");

    // GRADE
    let grade: string;
    if (contradictions.length >= 2) grade = "REJECT";
    else if (confirmations.length >= 4 && contradictions.length === 0) grade = "A";
    else if (confirmations.length >= 3 && contradictions.length === 0) grade = "B";
    else if (confirmations.length >= 2 && contradictions.length <= 1) grade = "C";
    else if (confirmations.length >= 1 && contradictions.length === 0) grade = "D";
    else grade = "REJECT";

    if (grade === "REJECT") return null;

    return {
        symbol: sym, grade, foundation, confirmations, contradictions,
        price: t.close, chg1d, chg5d, volRatio5, smFlow1d, smFlow1w,
    };
}

// ═══════════════════════════════════════════════════════════
// SCORING HELPERS
// ═══════════════════════════════════════════════════════════

function scoreSession({
    validSymbols, allCandles, smFlows, retailFlows, buyDate, sellDate, regime,
}: {
    validSymbols: string[];
    allCandles: Record<string, YahooCandle[]>;
    smFlows: Record<string, Record<string, number>>;
    retailFlows: Record<string, number>;
    buyDate: string;
    sellDate: string;
    regime: string;
}): { picks: GatedResult[]; allResults: GatedResult[] } {
    const maxPicks = regime === "AGGRESSIVE" ? 10 : regime === "NORMAL" ? 7 : 3;
    const sizeMultiplier = regime === "DEFENSIVE" ? 0.5 : 1;
    const results: GatedResult[] = [];

    for (const sym of validSymbols) {
        const candles = allCandles[sym];
        if (!candles) continue;

        const candleDateIdx = candles.findIndex(c => c.date === buyDate);
        const sellDateIdx = candles.findIndex(c => c.date === sellDate);
        if (candleDateIdx < 10 || sellDateIdx < 0) continue;

        const smFlow1d = smFlows["1d"]?.[sym] ?? 0;
        const smFlow1w = smFlows["1w"]?.[sym] ?? 0;
        const retailFlow1w = retailFlows[sym] ?? 0;

        const scored = applyGatedScoring({
            sym, candles, dateIdx: candleDateIdx,
            smFlow1d, smFlow1w, retailFlow1w,
        });
        if (!scored) continue;

        const entry = candles[candleDateIdx].close;
        const exit = candles[sellDateIdx].close;
        const nextDayPnl = ((exit - entry) / entry * 100) * sizeMultiplier;

        results.push({ ...scored, nextDayPnl });
    }

    const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    results.sort((a, b) =>
        (gradeOrder[a.grade] ?? 9) - (gradeOrder[b.grade] ?? 9) ||
        b.confirmations.length - a.confirmations.length
    );

    return { picks: results.slice(0, maxPicks), allResults: results };
}

// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

interface SessionResult {
    date: string;
    sellDate: string;
    regime: string;
    regimeScore: number;
    signals: string[];
    picks: GatedResult[];
    counterfactualPicks: GatedResult[]; // what SIT_OUT would have traded
}

async function main() {
    const LOOKBACK_DAYS = 30;

    printHeader(`REGIME + GATED SCORING BACKTEST (${LOOKBACK_DAYS} days)`);

    // 1. Fetch IHSG candles (90 days for MA lookback)
    console.log("  Fetching IHSG candles...");
    const ihsgCandles = await fetchYahooDaily({ symbol: "^JKSE", days: 90 });
    console.log(`  Got ${ihsgCandles.length} IHSG candles\n`);

    // 2. Generate sessions from last LOOKBACK_DAYS trading days
    // Need at least 20 candles before first session (for MA20), and +1 for sell date
    const startIdx = Math.max(20, ihsgCandles.length - LOOKBACK_DAYS - 1);
    const endIdx = ihsgCandles.length - 1; // last candle is sell-only (no next day)

    interface Session { buyDate: string; sellDate: string; ihsgIdx: number }
    const sessions: Session[] = [];
    for (let i = startIdx; i < endIdx; i++) {
        sessions.push({
            buyDate: ihsgCandles[i].date,
            sellDate: ihsgCandles[i + 1].date,
            ihsgIdx: i,
        });
    }
    console.log(`  Generated ${sessions.length} sessions: ${sessions[0].buyDate} → ${sessions[sessions.length - 1].sellDate}\n`);

    // 3. Fetch broker data for all sessions
    console.log("  Fetching SM broker activity...");
    const allSmFlows: Record<string, Record<string, Record<string, number>>> = {};

    // Batch in groups of 5 to avoid overwhelming API
    for (let batch = 0; batch < sessions.length; batch += 5) {
        const chunk = sessions.slice(batch, batch + 5);
        const promises = chunk.map(async (s) => {
            const ref = new Date(s.buyDate);
            const from1w = new Date(ref);
            from1w.setDate(from1w.getDate() - 7);

            const [flow1d, flow1w] = await Promise.all([
                fetchBrokerActivity({ brokers: SM_BROKERS, from: s.buyDate, to: s.buyDate }),
                fetchBrokerActivity({ brokers: SM_BROKERS, from: from1w.toISOString().slice(0, 10), to: s.buyDate }),
            ]);
            return { date: s.buyDate, flows: { "1d": flow1d, "1w": flow1w } };
        });
        const results = await Promise.all(promises);
        for (const r of results) allSmFlows[r.date] = r.flows;
        process.stdout.write(`\r  SM broker: ${Math.min(batch + 5, sessions.length)}/${sessions.length}`);
    }
    console.log();

    console.log("  Fetching retail broker activity...");
    const allBrokers = await fetchTopBrokers();
    const retailCodes = allBrokers
        .filter(b => b.group === "BROKER_GROUP_LOCAL")
        .map(b => b.code)
        .slice(0, 10);

    const allRetailFlows: Record<string, Record<string, number>> = {};
    for (let batch = 0; batch < sessions.length; batch += 5) {
        const chunk = sessions.slice(batch, batch + 5);
        const promises = chunk.map(async (s) => {
            const ref = new Date(s.buyDate);
            const from1w = new Date(ref);
            from1w.setDate(from1w.getDate() - 7);
            const flow = await fetchBrokerActivity({
                brokers: retailCodes,
                from: from1w.toISOString().slice(0, 10),
                to: s.buyDate,
            });
            return { date: s.buyDate, flow };
        });
        const results = await Promise.all(promises);
        for (const r of results) allRetailFlows[r.date] = r.flow;
        process.stdout.write(`\r  Retail broker: ${Math.min(batch + 5, sessions.length)}/${sessions.length}`);
    }
    console.log();

    // 4. Collect all symbols from broker data
    const allSymbols = [...new Set(
        Object.values(allSmFlows).flatMap(flows =>
            [...Object.keys(flows["1d"] ?? {}), ...Object.keys(flows["1w"] ?? {})]
        )
    )].filter(s => !s.includes("."));
    console.log(`  ${allSymbols.length} unique stocks in SM broker data`);

    // 5. Fetch Yahoo candles
    console.log(`  Fetching Yahoo candles for ${allSymbols.length} stocks...`);
    const allCandles = await fetchYahooDailyMulti({ symbols: allSymbols, days: 90 });
    const validSymbols = allSymbols.filter(s => (allCandles[s]?.length ?? 0) >= 15);
    console.log(`  ${validSymbols.length} stocks with enough data\n`);

    // 6. Run backtest
    const results: SessionResult[] = [];
    const reset = "\x1b[0m";
    const green = "\x1b[32m";
    const red = "\x1b[31m";
    const yellow = "\x1b[33m";
    const dim = "\x1b[90m";
    const cyan = "\x1b[36m";

    const regimeColors: Record<string, string> = {
        AGGRESSIVE: green,
        NORMAL: cyan,
        DEFENSIVE: yellow,
        SIT_OUT: red,
    };

    printSubHeader("SESSION RESULTS");
    console.log(`  ${"DATE".padEnd(12)} ${"REGIME".padEnd(12)} ${"SCORE".padStart(5)} ${"PICKS".padStart(5)} ${"W:L".padStart(5)} ${"AVG%".padStart(7)} ${"TOTAL%".padStart(8)}  SIGNALS`);
    console.log(`  ${"─".repeat(80)}`);

    for (const session of sessions) {
        const { score: regimeScore, regime, signals } = computeRegimeScore(ihsgCandles, session.ihsgIdx);

        // Always score (for counterfactual on SIT_OUT days)
        const { picks, allResults } = scoreSession({
            validSymbols, allCandles,
            smFlows: allSmFlows[session.buyDate],
            retailFlows: allRetailFlows[session.buyDate],
            buyDate: session.buyDate,
            sellDate: session.sellDate,
            regime: regime === "SIT_OUT" ? "NORMAL" : regime, // for counterfactual, use NORMAL sizing
        });

        const isSitOut = regime === "SIT_OUT";
        const activePicks = isSitOut ? [] : picks;
        const counterfactualPicks = isSitOut ? picks : [];

        results.push({
            date: session.buyDate,
            sellDate: session.sellDate,
            regime, regimeScore, signals,
            picks: activePicks,
            counterfactualPicks,
        });

        // Print compact session line
        const displayPicks = isSitOut ? counterfactualPicks : activePicks;
        const pickCount = displayPicks.length;
        const wins = displayPicks.filter(p => p.nextDayPnl > 0).length;
        const losses = displayPicks.filter(p => p.nextDayPnl <= 0).length;
        const totalPnl = displayPicks.reduce((s, p) => s + p.nextDayPnl, 0);
        const avgPnl = pickCount > 0 ? totalPnl / pickCount : 0;

        const regimeCol = regimeColors[regime] ?? "";
        const pnlCol = totalPnl > 0 ? green : totalPnl < -1 ? red : yellow;
        const prefix = isSitOut ? `${dim}✗` : " ";
        const suffix = isSitOut ? ` ${dim}(avoided)${reset}` : "";

        console.log(
            `  ${prefix}${session.buyDate} ${regimeCol}${regime.padEnd(12)}${reset}` +
            `${String(regimeScore).padStart(5)}` +
            `${String(pickCount).padStart(5)}` +
            `${`${wins}:${losses}`.padStart(5)}` +
            `${pnlCol}${(avgPnl >= 0 ? "+" : "") + avgPnl.toFixed(2) + "%"}${reset}`.padStart(18) +
            `${pnlCol}${(totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(2) + "%"}${reset}`.padStart(19) +
            `  ${dim}${signals.join(" ")}${reset}${suffix}`
        );

        // Show individual picks for active sessions
        if (!isSitOut && displayPicks.length > 0) {
            for (const p of displayPicks) {
                const pCol = p.nextDayPnl > 0 ? green : p.nextDayPnl < -1 ? red : yellow;
                const marker = p.nextDayPnl > 0 ? "W" : "L";
                console.log(
                    `    ${dim}[${p.grade}]${reset} ${p.symbol.padEnd(6)} ` +
                    `${pCol}${marker} ${(p.nextDayPnl >= 0 ? "+" : "") + p.nextDayPnl.toFixed(1)}%${reset}  ` +
                    `${dim}F:${p.foundation.join(",")} C:${p.confirmations.length} X:${p.contradictions.length}${reset}`
                );
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SUMMARY STATISTICS
    // ═══════════════════════════════════════════════════════════

    printSubHeader("PER-REGIME BREAKDOWN");

    const regimes = ["AGGRESSIVE", "NORMAL", "DEFENSIVE", "SIT_OUT"];
    for (const r of regimes) {
        const rSessions = results.filter(s => s.regime === r);
        if (rSessions.length === 0) continue;

        const isActive = r !== "SIT_OUT";
        const picks = rSessions.flatMap(s => isActive ? s.picks : s.counterfactualPicks);
        const totalPnl = picks.reduce((s, p) => s + p.nextDayPnl, 0);
        const wins = picks.filter(p => p.nextDayPnl > 0).length;
        const losses = picks.filter(p => p.nextDayPnl <= 0).length;
        const avgPnl = picks.length > 0 ? totalPnl / picks.length : 0;
        const winRate = picks.length > 0 ? (wins / picks.length * 100).toFixed(0) : "N/A";

        const col = regimeColors[r] ?? "";
        const label = isActive ? "" : " (counterfactual — NOT traded)";
        console.log(`  ${col}${r}${reset}${label}`);
        console.log(`    ${rSessions.length} sessions | ${picks.length} picks | W${wins}:L${losses} (${winRate}%) | Avg: ${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(2)}% | Total: ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}%`);

        // Per-grade breakdown within regime
        const grades = ["A", "B", "C", "D"];
        for (const g of grades) {
            const gPicks = picks.filter(p => p.grade === g);
            if (gPicks.length === 0) continue;
            const gPnl = gPicks.reduce((s, p) => s + p.nextDayPnl, 0);
            const gWins = gPicks.filter(p => p.nextDayPnl > 0).length;
            const gAvg = gPnl / gPicks.length;
            console.log(`      [${g}] ${gPicks.length} picks | W${gWins}:L${gPicks.length - gWins} | Avg: ${gAvg >= 0 ? "+" : ""}${gAvg.toFixed(2)}% | Total: ${gPnl >= 0 ? "+" : ""}${gPnl.toFixed(2)}%`);
        }
    }

    // ═══ WITH vs WITHOUT REGIME ═══
    printSubHeader("WITH REGIME vs WITHOUT REGIME");

    // WITH regime: only active sessions
    const activeSessions = results.filter(s => s.regime !== "SIT_OUT");
    const activePicks = activeSessions.flatMap(s => s.picks);
    const activePnl = activePicks.reduce((s, p) => s + p.nextDayPnl, 0);
    const activeWins = activePicks.filter(p => p.nextDayPnl > 0).length;
    const activeLosses = activePicks.length - activeWins;
    const activeAvg = activePicks.length > 0 ? activePnl / activePicks.length : 0;
    const activeWinRate = activePicks.length > 0 ? (activeWins / activePicks.length * 100).toFixed(0) : "N/A";

    // WITHOUT regime: all sessions treated as NORMAL
    const allPicks = results.flatMap(s => s.regime === "SIT_OUT" ? s.counterfactualPicks : s.picks);
    const allPnl = allPicks.reduce((s, p) => s + p.nextDayPnl, 0);
    const allWins = allPicks.filter(p => p.nextDayPnl > 0).length;
    const allLosses = allPicks.length - allWins;
    const allAvg = allPicks.length > 0 ? allPnl / allPicks.length : 0;
    const allWinRate = allPicks.length > 0 ? (allWins / allPicks.length * 100).toFixed(0) : "N/A";

    // SIT_OUT counterfactual only
    const sitOutSessions = results.filter(s => s.regime === "SIT_OUT");
    const sitOutPicks = sitOutSessions.flatMap(s => s.counterfactualPicks);
    const sitOutPnl = sitOutPicks.reduce((s, p) => s + p.nextDayPnl, 0);
    const sitOutWins = sitOutPicks.filter(p => p.nextDayPnl > 0).length;

    console.log(`  ${green}WITH REGIME${reset} (actual trades):`);
    console.log(`    ${activeSessions.length} sessions | ${activePicks.length} trades | W${activeWins}:L${activeLosses} (${activeWinRate}%) | Avg: ${activeAvg >= 0 ? "+" : ""}${activeAvg.toFixed(2)}% | Total: ${green}${activePnl >= 0 ? "+" : ""}${activePnl.toFixed(2)}%${reset}`);

    console.log(`  ${red}WITHOUT REGIME${reset} (all sessions traded):`);
    console.log(`    ${results.length} sessions | ${allPicks.length} trades | W${allWins}:L${allLosses} (${allWinRate}%) | Avg: ${allAvg >= 0 ? "+" : ""}${allAvg.toFixed(2)}% | Total: ${allPnl >= 0 ? "+" : ""}${allPnl.toFixed(2)}%`);

    console.log(`  ${yellow}REGIME VALUE${reset} (what detector saved/cost):`);
    const regimeValue = activePnl - allPnl;
    console.log(`    SIT_OUT blocked ${sitOutSessions.length} sessions, ${sitOutPicks.length} trades`);
    console.log(`    Avoided P&L: ${sitOutPnl >= 0 ? "+" : ""}${sitOutPnl.toFixed(2)}% (W${sitOutWins}:L${sitOutPicks.length - sitOutWins})`);
    console.log(`    Net regime value: ${green}${regimeValue >= 0 ? "+" : ""}${regimeValue.toFixed(2)}%${reset}`);

    // ═══ MAX DRAWDOWN ═══
    printSubHeader("EQUITY CURVE (with regime)");
    let cumPnl = 0;
    let maxCumPnl = 0;
    let maxDrawdown = 0;
    let peakDate = "";
    let troughDate = "";
    let currentPeakDate = sessions[0]?.buyDate ?? "";

    for (const s of results) {
        if (s.regime === "SIT_OUT") continue;
        const dayPnl = s.picks.reduce((sum, p) => sum + p.nextDayPnl, 0);
        cumPnl += dayPnl;
        if (cumPnl > maxCumPnl) {
            maxCumPnl = cumPnl;
            currentPeakDate = s.date;
        }
        const dd = maxCumPnl - cumPnl;
        if (dd > maxDrawdown) {
            maxDrawdown = dd;
            peakDate = currentPeakDate;
            troughDate = s.date;
        }
    }

    console.log(`  Final P&L: ${cumPnl >= 0 ? "+" : ""}${cumPnl.toFixed(2)}%`);
    console.log(`  Max Drawdown: -${maxDrawdown.toFixed(2)}%${peakDate ? ` (${peakDate} → ${troughDate})` : ""}`);
    console.log(`  Peak: +${maxCumPnl.toFixed(2)}%`);

    // Profit factor
    const grossProfit = activePicks.filter(p => p.nextDayPnl > 0).reduce((s, p) => s + p.nextDayPnl, 0);
    const grossLoss = Math.abs(activePicks.filter(p => p.nextDayPnl <= 0).reduce((s, p) => s + p.nextDayPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;
    console.log(`  Profit Factor: ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)} (gross profit / gross loss)`);

    console.log(`\n  ${dim}Note: regime scoring uses IHSG trend/MA only (no breadth — not available historically)${reset}`);
}

main();
