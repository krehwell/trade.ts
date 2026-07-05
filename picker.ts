/**
 * Improved daily pick analyzer.
 *
 * Lessons from backtesting (Apr 21 to 23):
 *   Winners were momentum runners that KEPT running (COAL +34%, BDMN +25%, BAIK +20%).
 *   "Overextended" stocks continued, so penalizing them was wrong.
 *   Volume spikes marked CONTINUATION not exhaustion when paired with bandar accumulation.
 *   Conservative "safe" picks (LPPF, DMAS, OMED) went nowhere (+0% avg).
 *   The edge: bandar accumulation + volume breakout + price momentum in small/mid caps.
 */

import { fetchScreener, type ScreenerStock } from "./data/fetchScreener.ts";
import { fetchBrokerActivity, fetchBrokerActivityMultiTF, RETAIL_BROKERS, SM_BROKERS } from "./data/fetchBrokerActivity.ts";
import { fetchDailyMulti as fetchYahooDailyMulti } from "./data/stockbitCandles.ts";
import { type YahooCandle } from "./data/yahooCandles.ts";
import { fetchPOST } from "./net/stockbitFetch.ts";
import { ITEMS } from "./data/screenerItems.ts";
import { daysAgo, fmt, subDays, today } from "./util/date.ts";
import { fmtNum, printHeader, printSubHeader, printTable } from "./util/print.ts";
import { detectRegime, printRegime } from "./market/marketRegime.ts";
import { fetchStockMeta } from "./data/growinMeta.ts";

// Fetch screener with specific columns in the results (via sequence param)
const fetchScreenerWithColumns = async ({ filters, columns, orderCol, orderType = "desc" }: {
    filters: { id: number; operator: string; value: number | string }[];
    columns: number[];
    orderCol: number;
    orderType?: "asc" | "desc";
}): Promise<ScreenerStock[]> => {
    const all: ScreenerStock[] = [];
    let page = 1;
    while (true) {
        const filterPayload = filters.map(f => ({
            type: "basic", item1: f.id, item1name: "",
            operator: f.operator, item2: String(f.value), multiplier: "",
        }));
        const json = await fetchPOST({
            path: "/screener/templates",
            body: {
                name: "screen", description: "", save: "0",
                ordertype: orderType, ordercol: orderCol, page,
                universe: JSON.stringify({ scope: "IHSG", scopeID: "", name: "" }),
                filters: JSON.stringify(filterPayload),
                sequence: columns.join(","),
                screenerid: "0",
                type: "TEMPLATE_TYPE_CUSTOM",
            },
        });
        const d = json.data;
        const stocks: ScreenerStock[] = (d.calcs ?? []).map((c: any) => {
            const results: Record<string, number> = {};
            for (const r of c.results) results[r.id] = Number(r.raw);
            return { symbol: c.company.symbol, name: c.company.name, results };
        });
        all.push(...stocks);
        if (all.length >= d.totalrows) break;
        page++;
    }
    return all;
};


interface Candidate {
    symbol: string;
    price: number;
    marketCap: number;
    // Screener data
    bandarValue: number;
    bandarPrev: number;
    bandarMA10: number;
    bandarMA20: number;
    bandarAccDist: number;
    returns3m: number;
    // Yahoo candle data
    chg1d: number;
    chg3d: number;
    chg5d: number;
    vol: number;
    avgVol5: number;
    avgVol10: number;
    volRatio5: number;
    volRatio10: number;
    volTrend: number; // slope of volume over 5 days
    // Price pattern
    rangePosition: number; // where price sits in 10d range (0=low, 1=high)
    gapUp: boolean; // opened above previous close
    closedNearHigh: boolean; // close in top 30% of today's range
    higher_lows_3d: boolean;
    // SM broker flow
    smFlow1d: number;
    smFlow1w: number;
    // Gated scoring
    foundation: string[];       // must have at least 1
    confirmations: string[];    // only counted if foundation passes
    contradictions: string[];   // vetoes that downgrade
    grade: "A" | "B" | "C" | "D" | "REJECT";
    score: number;              // confirmations minus contradictions (only for sorting within grade)
    signals: string[];          // all signals for display
}

async function main() {
    printHeader(`IMPROVED ANALYZER — ${today()}`);

    // Regime gate: a hostile market (SIT_OUT) overrides every stock level signal,
    // so bail before doing any expensive per stock work.
    const regime = await detectRegime();
    printRegime(regime);

    if (regime.regime === "SIT_OUT") {
        console.log("  Stopping analysis — market regime is hostile.");
        return;
    }

    // Bandar (smart money) data for every liquid stock that's net bought today.
    printSubHeader("Step 1: Screener with bandar data");
    const bandarDetailStocks = await fetchScreenerWithColumns({
        filters: [
            { id: ITEMS.PRICE, operator: ">", value: 50 },
            { id: ITEMS.VALUE_MA50, operator: ">", value: 500_000_000 },
            { id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 },
        ],
        columns: [
            ITEMS.PRICE, ITEMS.MARKET_CAP, ITEMS.RETURNS_3M,
            ITEMS.BANDAR_VALUE, ITEMS.BANDAR_PREV_VALUE,
            ITEMS.BANDAR_VALUE_MA10, ITEMS.BANDAR_VALUE_MA20,
            ITEMS.BANDAR_ACCUM_DIST,
        ],
        orderCol: ITEMS.BANDAR_VALUE,
    });
    console.log(`  Bandar buying today: ${bandarDetailStocks.length} stocks`);

    // Index screener rows by symbol so we can join them with candle data later.
    const screenerMap = new Map<string, ScreenerStock>();
    for (const s of bandarDetailStocks) screenerMap.set(s.symbol, s);

    // Smart money broker net flow (1d + 1w).  Used for bandar/SM confluence checks.
    // Anchor to the last trading day, not today(): on a weekend/holiday run the
    // "1d" window would cover only dead days and zero out SM1d for every stock.
    const dayAfterLast = regime.lastTradingDate
        ? fmt(subDays(new Date(regime.lastTradingDate), -1)) // subDays(-1) = +1 day
        : today();
    const flowDate = dayAfterLast < today() ? dayAfterLast : today();
    printSubHeader("Step 2: SM Broker flow");
    const smFlows = await fetchBrokerActivityMultiTF({
        brokers: SM_BROKERS,
        date: flowDate,
        timeframes: ["1d", "1w"],
    });

    // Retail flow.  Spots retail selling into smart money buying.
    const retailFlow1w = await fetchBrokerActivity({
        brokers: RETAIL_BROKERS,
        from: daysAgo(7),
        to: today(),
    });

    // Daily candles (Stockbit first, Yahoo fallback) for price/volume structure.
    printSubHeader("Step 3: Price & volume data");
    const symbols = bandarDetailStocks.map(s => s.symbol);
    console.log(`  Fetching candles for ${symbols.length} bandar-buying stocks...`);
    const candles = await fetchYahooDailyMulti({ symbols, days: 30 });

    // Score each candidate: foundation gate -> confirmations -> contradictions -> grade.
    printSubHeader("Step 4: Scoring");
    const candidates: Candidate[] = [];

    for (const sym of symbols) {
        const scrData = screenerMap.get(sym);
        const yahooCandles = candles[sym];
        if (!scrData || !yahooCandles || yahooCandles.length < 10) continue;

        const c = yahooCandles;
        const last = c.length - 1;
        const t = c[last]; // today
        const y = c[last - 1]; // yesterday

        // Price change over 1/3/5 trading days.
        const chg1d = (t.close - y.close) / y.close * 100;
        const chg3d = last >= 3 ? (t.close - c[last - 3].close) / c[last - 3].close * 100 : 0;
        const chg5d = last >= 5 ? (t.close - c[last - 5].close) / c[last - 5].close * 100 : 0;

        // Today's volume vs the trailing 5d/10d average (today excluded from the average).
        const avgVol5 = c.slice(-6, -1).reduce((s, x) => s + x.volume, 0) / 5;
        const avgVol10 = c.slice(-11, -1).reduce((s, x) => s + x.volume, 0) / Math.min(10, c.length - 1);
        const volRatio5 = t.volume / (avgVol5 || 1);
        const volRatio10 = t.volume / (avgVol10 || 1);

        // Volume direction over 5 days: >0 expanding, <0 contracting.
        const vols5 = c.slice(-5).map(x => x.volume);
        const volTrend = vols5.length >= 2 ? (vols5[vols5.length - 1] - vols5[0]) / (vols5[0] || 1) : 0;

        // Where today's close sits in the 10-day range (0 = at the low, 1 = at the high).
        const highs10 = c.slice(-10).map(x => x.high);
        const lows10 = c.slice(-10).map(x => x.low);
        const high10 = Math.max(...highs10);
        const low10 = Math.min(...lows10);
        const rangePosition = high10 !== low10 ? (t.close - low10) / (high10 - low10) : 0.5;

        const gapUp = t.open > y.close;

        // Closed in the top 30% of today's range = buyers in control.
        const todayRange = t.high - t.low;
        const closedNearHigh = todayRange > 0 ? (t.close - t.low) / todayRange > 0.7 : false;

        // Three straight higher lows = a building uptrend.
        const higher_lows_3d = last >= 2 &&
            c[last].low >= c[last - 1].low &&
            c[last - 1].low >= c[last - 2].low;

        // Screener results are keyed by numeric item ID (see screenerItems.ts).
        const r = scrData.results;
        const price = r[ITEMS.PRICE] || t.close;
        const marketCap = r[ITEMS.MARKET_CAP] || 0;
        const bandarValue = r[ITEMS.BANDAR_VALUE] || 0;
        const bandarPrev = r[ITEMS.BANDAR_PREV_VALUE] || 0;
        const bandarMA10 = r[ITEMS.BANDAR_VALUE_MA10] || 0;
        const bandarMA20 = r[ITEMS.BANDAR_VALUE_MA20] || 0;
        const bandarAccDist = r[ITEMS.BANDAR_ACCUM_DIST] || 0;
        const returns3m = r[ITEMS.RETURNS_3M] || 0;

        // SM flow
        const smFlow1d = smFlows["1d"]?.[sym] ?? 0;
        const smFlow1w = smFlows["1w"]?.[sym] ?? 0;

        // === GATED SCORING ===
        // Foundation -> Confirmation -> Contradiction cross check
        const foundation: string[] = [];
        const confirmations: string[] = [];
        const contradictions: string[] = [];
        const retail1w = retailFlow1w[sym] ?? 0;
        const closedNearLow = todayRange > 0 && (t.close - t.low) / todayRange < 0.3;

        // ═══ FOUNDATION (need at least 1 to proceed) ═══
        // F1: Bandar accumulation trend (value > 0 AND above MA10 or accelerating)
        if (bandarValue > 0 && (bandarValue > bandarMA10 || (bandarValue > bandarPrev && bandarPrev > 0))) {
            foundation.push("bandarTrend");
        }
        // F2: SM broker weekly accumulation
        if (smFlow1w > 0) {
            foundation.push("SM1w+");
        }
        // F3: Strong bandar with accum/dist confirmation
        if (bandarValue > 0 && bandarAccDist > 0) {
            foundation.push("bandarAccDist+");
        }

        // No foundation -> reject immediately
        if (foundation.length === 0) {
            continue; // skip this stock entirely
        }

        // ═══ CONFIRMATIONS (cross validated pairs) ═══
        // C1: Volume confirms price.  High vol + close near high = real buying.
        if (volRatio5 > 1.5 && closedNearHigh) {
            confirmations.push(`vol${volRatio5.toFixed(1)}x+closeHigh`);
        }
        // C2: Volume breakout with expanding trend (not just a spike)
        if (volRatio5 > 2.0 && volTrend > 0) {
            confirmations.push(`vol${volRatio5.toFixed(1)}x+expanding`);
        }
        // C3: Bandar + SM alignment (both buying = strong confluence)
        if (bandarValue > 0 && smFlow1d > 0) {
            confirmations.push("bandar+SM aligned");
        }
        // C4: Momentum confirmed by volume (price up + vol up = real move)
        if (chg1d > 2 && volRatio5 > 1.5) {
            confirmations.push(`+${chg1d.toFixed(1)}%+vol`);
        }
        // C5: Retail divergence: retail selling while bandar buying.
        if (retail1w < 0 && bandarValue > 0 && smFlow1w >= 0) {
            confirmations.push("retailDiv");
        }
        // C6: Price structure: higher lows + close near high = building.
        if (higher_lows_3d && closedNearHigh) {
            confirmations.push("structure+");
        }
        // C7: Bandar acceleration with volume: today > yesterday AND vol confirms.
        if (bandarValue > bandarPrev && bandarPrev > 0 && volRatio5 > 1.2) {
            confirmations.push("bandarAccel+vol");
        }
        // C8: Multi day momentum confirmed by bandar trend
        if (chg3d > 3 && bandarValue > bandarMA10 && bandarMA10 > 0) {
            confirmations.push("momentum+bandarTrend");
        }

        // ═══ CONTRADICTIONS (signals that conflict) ═══
        // X1: Volume spike BUT close near low = distribution, not accumulation
        if (volRatio5 > 2.0 && closedNearLow) {
            contradictions.push("highVol+closeLow=DISTRIBUTION");
        }
        // X2: Bandar buying BUT SM selling = conflicting smart money
        if (bandarValue > 0 && smFlow1w < 0) {
            contradictions.push("bandar+vsSM-=CONFLICT");
        }
        // X3: Price up BUT volume dying = fake/unsustained move
        if (chg1d > 2 && volRatio5 < 0.8) {
            contradictions.push("priceUp+volDead=FAKE");
        }
        // X4: Momentum up BUT close near low = rejection / exhaustion
        if (chg5d > 15 && closedNearLow && chg1d < 0) {
            contradictions.push("extended+rejection=EXHAUSTION");
        }
        // X5: Gap up then closed red = buyer rejection
        if (gapUp && chg1d < -1) {
            contradictions.push("gapRejection");
        }
        // X6: Volume declining multi day while price rising = unsustainable
        if (chg3d > 5 && volTrend < -0.3) {
            contradictions.push("priceUp+volFading=WEAK");
        }

        // ═══ GRADE ASSIGNMENT ═══
        const netScore = confirmations.length - contradictions.length;
        let grade: "A" | "B" | "C" | "D" | "REJECT";

        if (contradictions.length >= 2) {
            grade = "REJECT"; // multiple conflicts = unreliable
        } else if (confirmations.length >= 4 && contradictions.length === 0) {
            grade = "A"; // strong confluence, no conflicts
        } else if (confirmations.length >= 3 && contradictions.length === 0) {
            grade = "B"; // good confluence, clean
        } else if (confirmations.length >= 2 && contradictions.length <= 1) {
            grade = "C"; // moderate, minor concern
        } else if (confirmations.length >= 1 && contradictions.length === 0) {
            grade = "D"; // weak but clean
        } else {
            grade = "REJECT";
        }

        if (grade === "REJECT") continue;

        // Build signals for display
        const signals = [
            `[${foundation.join(",")}]`,
            ...confirmations.map(c => `+${c}`),
            ...contradictions.map(c => `-${c}`),
        ];

        candidates.push({
            symbol: sym, price, marketCap,
            bandarValue, bandarPrev, bandarMA10, bandarMA20, bandarAccDist,
            returns3m,
            chg1d, chg3d, chg5d,
            vol: t.volume, avgVol5, avgVol10,
            volRatio5, volRatio10, volTrend,
            rangePosition, gapUp, closedNearHigh, higher_lows_3d,
            smFlow1d, smFlow1w,
            foundation, confirmations, contradictions, grade,
            score: netScore, signals,
        });
    }

    // Sort by grade (A>B>C>D) then by confirmations within grade
    const gradeOrder = { A: 0, B: 1, C: 2, D: 3, REJECT: 4 };
    candidates.sort((a, b) => gradeOrder[a.grade] - gradeOrder[b.grade] || b.score - a.score);

    // Veto what scoring can't see: suspension, UMA, ex-date mechanical gap.
    // Top 15 only (one Growin login + 15 REST calls). Skipped with a warn if Growin is down.
    const checkN = Math.min(candidates.length, 15);
    try {
        const kept: Candidate[] = [];
        for (const c of candidates.slice(0, checkN)) {
            const m = await fetchStockMeta({ symbol: c.symbol });
            const veto = m.isSuspended ? "suspended"
                : m.isUma ? "UMA"
                : m.corporateAction.startsWith("X") ? `ex-date (${m.corporateActionString})`
                : "";
            if (veto) {
                console.log(`  VETO ${c.symbol}: ${veto}`);
                continue;
            }
            kept.push(c);
        }
        candidates.splice(0, checkN, ...kept);
    } catch (e) {
        console.log(`  warn: Growin veto skipped, ${(e as Error).message}`);
    }

    // Print results
    const gradeA = candidates.filter(c => c.grade === "A").length;
    const gradeB = candidates.filter(c => c.grade === "B").length;
    const gradeC = candidates.filter(c => c.grade === "C").length;
    const gradeD = candidates.filter(c => c.grade === "D").length;
    printSubHeader(`CANDIDATES: ${candidates.length} passed (A:${gradeA} B:${gradeB} C:${gradeC} D:${gradeD})`);
    printTable({
        columns: [
            { label: "#", width: 4, align: "right" },
            { label: "Stock", width: 7 },
            { label: "Grd", width: 4 },
            { label: "Conf", width: 5, align: "right" },
            { label: "Contr", width: 5, align: "right" },
            { label: "Price", width: 8, align: "right" },
            { label: "Chg1d", width: 7, align: "right" },
            { label: "Vol/5d", width: 7, align: "right" },
            { label: "Bandar", width: 10, align: "right" },
            { label: "SM1w", width: 10, align: "right" },
            { label: "Signals", width: 50 },
        ],
        rows: candidates.slice(0, 30).map((c, i) => [
            String(i + 1),
            c.symbol,
            c.grade,
            String(c.confirmations.length),
            String(c.contradictions.length),
            String(c.price),
            `${c.chg1d >= 0 ? "+" : ""}${c.chg1d.toFixed(1)}%`,
            `${c.volRatio5.toFixed(1)}x`,
            fmtNum(c.bandarValue),
            fmtNum(c.smFlow1w),
            c.signals.join(", "),
        ]),
        limit: 30,
    });

    // Regime aware pick count
    const maxPicks = regime.regime === "AGGRESSIVE" ? 10 : regime.regime === "NORMAL" ? 7 : 3;
    printSubHeader(`DETAILED VIEW — Top ${maxPicks} (regime: ${regime.regime})`);
    for (const c of candidates.slice(0, maxPicks)) {
        const yahooC = candles[c.symbol];
        if (!yahooC) continue;

        const gradeColor = c.grade === "A" ? "\x1b[32m" : c.grade === "B" ? "\x1b[33m" : "\x1b[90m";
        const reset = "\x1b[0m";

        console.log(`\n  ${gradeColor}[${c.grade}]${reset} ${c.symbol} — ${c.price}`);
        console.log(`    Foundation: ${c.foundation.join(", ")}`);
        console.log(`    Confirmed:  ${c.confirmations.length > 0 ? c.confirmations.join(" | ") : "none"}`);
        if (c.contradictions.length > 0) {
            console.log(`    \x1b[31mConflicts:  ${c.contradictions.join(" | ")}\x1b[0m`);
        }
        console.log(`    Price: 1d: ${c.chg1d >= 0 ? "+" : ""}${c.chg1d.toFixed(1)}% | 3d: ${c.chg3d >= 0 ? "+" : ""}${c.chg3d.toFixed(1)}% | 5d: ${c.chg5d >= 0 ? "+" : ""}${c.chg5d.toFixed(1)}%`);
        console.log(`    Vol: ${c.volRatio5.toFixed(1)}x 5d avg | Trend: ${c.volTrend > 0 ? "expanding" : "flat/contracting"}`);
        console.log(`    Bandar: ${fmtNum(c.bandarValue)} (prev: ${fmtNum(c.bandarPrev)}) | AccDist: ${fmtNum(c.bandarAccDist)}`);
        console.log(`    SM 1d: ${fmtNum(c.smFlow1d)} | SM 1w: ${fmtNum(c.smFlow1w)}`);
        console.log(`    Range pos: ${(c.rangePosition * 100).toFixed(0)}% | CloseHigh: ${c.closedNearHigh} | HigherLows: ${c.higher_lows_3d}`);

        // Last 5 candles
        console.log(`    Last 5 candles:`);
        for (let i = Math.max(0, yahooC.length - 5); i < yahooC.length; i++) {
            const candle = yahooC[i];
            const prev = i > 0 ? yahooC[i - 1] : null;
            const chg = prev ? ((candle.close - prev.close) / prev.close * 100).toFixed(1) : "0.0";
            const body = candle.close >= candle.open ? "\x1b[32m" : "\x1b[31m";
            console.log(`      ${body}${candle.date} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close}\x1b[0m | Vol:${candle.volume} | ${Number(chg) >= 0 ? "+" : ""}${chg}%`);
        }
    }
}

main();
