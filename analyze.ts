/**
 * Improved daily pick analyzer.
 *
 * Lessons from backtesting Apr 21-23:
 * - Winners were momentum runners that KEPT running (COAL +34%, BDMN +25%, BAIK +20%)
 * - "Overextended" stocks continued. Penalizing them was wrong.
 * - Volume spikes marked CONTINUATION, not exhaustion, when paired with bandar accumulation
 * - Conservative "safe" picks (LPPF, DMAS, OMED) went nowhere (+0% avg)
 * - The edge is: bandar accumulation + volume breakout + price momentum in small/mid caps
 */

import { fetchScreener, type ScreenerStock } from "./fetchScreener.ts";
import { fetchBrokerActivity, fetchBrokerActivityMultiTF, fetchTopBrokers } from "./fetchBrokerActivity.ts";
import { fetchYahooDailyMulti, type YahooCandle } from "./utils/yahooFetch.ts";
import { fetchPOST } from "./utils/stockbitFetch.ts";
import { ITEMS } from "./screenerItems.ts";
import { daysAgo, today } from "./utils/date.ts";
import { fmtNum, printHeader, printSubHeader, printTable } from "./utils/print.ts";
import { detectRegime, printRegime } from "./marketRegime.ts";

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

// Smart money brokers
const SM_BROKERS = ["MS", "BK", "CS", "CG", "GW", "KZ", "RX", "DP", "AK", "ZP", "LG", "TP", "KI", "HP"];

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
    // Final
    score: number;
    signals: string[];
}

async function main() {
    printHeader(`IMPROVED ANALYZER — ${today()}`);

    // Step 0: Market regime check
    const regime = await detectRegime();
    printRegime(regime);

    if (regime.regime === "SIT_OUT") {
        console.log("  Stopping analysis — market regime is hostile.");
        return;
    }

    // Step 1: Screener — get bandar data for all liquid stocks with bandar buying
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

    // Build lookup from screener
    const screenerMap = new Map<string, ScreenerStock>();
    for (const s of bandarDetailStocks) screenerMap.set(s.symbol, s);

    // Step 3: Get SM broker flow for top candidates
    printSubHeader("Step 2: SM Broker flow");
    const smFlows = await fetchBrokerActivityMultiTF({
        brokers: SM_BROKERS,
        date: today(),
        timeframes: ["1d", "1w"],
    });

    // Step 4: Retail broker flow (for divergence detection)
    const allBrokers = await fetchTopBrokers();
    const retailCodes = allBrokers
        .filter((b) => b.group === "BROKER_GROUP_LOCAL")
        .map((b) => b.code)
        .slice(0, 10);
    const retailFlow1w = await fetchBrokerActivity({
        brokers: retailCodes,
        from: daysAgo(7),
        to: today(),
    });

    // Step 5: Yahoo candle data for price/volume analysis
    printSubHeader("Step 3: Price & volume data (Yahoo)");
    const symbols = bandarDetailStocks.map(s => s.symbol);
    console.log(`  Fetching candles for ${symbols.length} bandar-buying stocks...`);
    const candles = await fetchYahooDailyMulti({ symbols, days: 30 });

    // Step 6: Score everything
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

        // Price metrics
        const chg1d = (t.close - y.close) / y.close * 100;
        const chg3d = last >= 3 ? (t.close - c[last - 3].close) / c[last - 3].close * 100 : 0;
        const chg5d = last >= 5 ? (t.close - c[last - 5].close) / c[last - 5].close * 100 : 0;

        // Volume metrics
        const avgVol5 = c.slice(-6, -1).reduce((s, x) => s + x.volume, 0) / 5;
        const avgVol10 = c.slice(-11, -1).reduce((s, x) => s + x.volume, 0) / Math.min(10, c.length - 1);
        const volRatio5 = t.volume / (avgVol5 || 1);
        const volRatio10 = t.volume / (avgVol10 || 1);

        // Volume trend (5d slope)
        const vols5 = c.slice(-5).map(x => x.volume);
        const volTrend = vols5.length >= 2 ? (vols5[vols5.length - 1] - vols5[0]) / (vols5[0] || 1) : 0;

        // Price position in 10d range
        const highs10 = c.slice(-10).map(x => x.high);
        const lows10 = c.slice(-10).map(x => x.low);
        const high10 = Math.max(...highs10);
        const low10 = Math.min(...lows10);
        const rangePosition = high10 !== low10 ? (t.close - low10) / (high10 - low10) : 0.5;

        // Gap up?
        const gapUp = t.open > y.close;

        // Close near high?
        const todayRange = t.high - t.low;
        const closedNearHigh = todayRange > 0 ? (t.close - t.low) / todayRange > 0.7 : false;

        // Higher lows 3d?
        const higher_lows_3d = last >= 2 &&
            c[last].low >= c[last - 1].low &&
            c[last - 1].low >= c[last - 2].low;

        // Screener data (results keyed by item ID number)
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

        // --- SCORING ---
        let score = 0;
        const signals: string[] = [];

        // 1. BANDAR MOMENTUM (most important signal from backtest)
        //    Bandar value > MA10 AND MA20 = accumulation trend
        if (bandarValue > 0) {
            score += 3;
            signals.push("bandar+");
        }
        if (bandarValue > bandarMA10 && bandarMA10 > 0) {
            score += 3;
            signals.push("bandar>MA10");
        }
        if (bandarValue > bandarMA20 && bandarMA20 > 0) {
            score += 2;
            signals.push("bandar>MA20");
        }
        // Bandar acceleration: today > yesterday
        if (bandarValue > bandarPrev && bandarPrev > 0) {
            score += 3;
            signals.push("bandar↑↑");
        }
        // Bandar accumulation/distribution positive
        if (bandarAccDist > 0) {
            score += 2;
            signals.push("accDist+");
        }

        // 2. VOLUME BREAKOUT (second most important — this caught COAL, BDMN, BAIK)
        if (volRatio5 > 3.0) {
            score += 5;
            signals.push(`vol ${volRatio5.toFixed(1)}x!`);
        } else if (volRatio5 > 2.0) {
            score += 3;
            signals.push(`vol ${volRatio5.toFixed(1)}x`);
        } else if (volRatio5 > 1.5) {
            score += 2;
            signals.push(`vol ${volRatio5.toFixed(1)}x`);
        }

        // Volume expanding over days (not just a single spike)
        if (volTrend > 0.5) {
            score += 2;
            signals.push("volExpanding");
        }

        // 3. PRICE MOMENTUM (the winners kept running — don't penalize momentum!)
        if (chg1d > 5 && chg1d <= 15) {
            score += 3;
            signals.push(`+${chg1d.toFixed(1)}%today`);
        } else if (chg1d > 2) {
            score += 2;
            signals.push(`+${chg1d.toFixed(1)}%today`);
        } else if (chg1d > 0) {
            score += 1;
        }

        // Multi-day momentum — stocks that ran 3-5 days continue
        if (chg3d > 5 && chg5d > 10) {
            score += 2;
            signals.push("momentum3-5d");
        }

        // 4. PRICE PATTERN
        if (closedNearHigh) {
            score += 2;
            signals.push("closeNearHigh");
        }
        if (higher_lows_3d) {
            score += 1;
            signals.push("higherLows");
        }

        // 5. SM BROKER CONFIRMATION
        if (smFlow1d > 0) {
            score += 2;
            signals.push("SM1d+");
        }
        if (smFlow1w > 0) {
            score += 2;
            signals.push("SM1w+");
        }

        // 6. RETAIL DIVERGENCE (retail selling while bandar buying = strong)
        const retail1w = retailFlow1w[sym] ?? 0;
        if (retail1w < 0 && bandarValue > 0) {
            score += 2;
            signals.push("retailSelling");
        }

        // 7. PENALTIES
        // Only penalize if stock is up >25% AND volume is dying (exhaustion)
        if (chg5d > 25 && volRatio5 < 1.0) {
            score -= 4;
            signals.push("EXHAUSTION");
        }
        // Closed near low = weakness
        if (todayRange > 0 && (t.close - t.low) / todayRange < 0.3 && chg1d < 0) {
            score -= 3;
            signals.push("closeNearLow");
        }
        // Gap up then close red = rejection
        if (gapUp && chg1d < -1) {
            score -= 3;
            signals.push("gapRejection");
        }

        candidates.push({
            symbol: sym, price, marketCap,
            bandarValue, bandarPrev, bandarMA10, bandarMA20, bandarAccDist,
            returns3m,
            chg1d, chg3d, chg5d,
            vol: t.volume, avgVol5, avgVol10,
            volRatio5, volRatio10, volTrend,
            rangePosition, gapUp, closedNearHigh, higher_lows_3d,
            smFlow1d, smFlow1w,
            score, signals,
        });
    }

    candidates.sort((a, b) => b.score - a.score);

    // Print results
    printSubHeader(`TOP CANDIDATES (${candidates.length} scored)`);
    printTable({
        columns: [
            { label: "#", width: 4, align: "right" },
            { label: "Stock", width: 7 },
            { label: "Score", width: 6, align: "right" },
            { label: "Price", width: 8, align: "right" },
            { label: "Chg1d", width: 7, align: "right" },
            { label: "Chg5d", width: 7, align: "right" },
            { label: "Vol/5d", width: 7, align: "right" },
            { label: "Bandar", width: 10, align: "right" },
            { label: "BdPrev", width: 10, align: "right" },
            { label: "AccDist", width: 10, align: "right" },
            { label: "SM1w", width: 10, align: "right" },
            { label: "Signals", width: 40 },
        ],
        rows: candidates.slice(0, 30).map((c, i) => [
            String(i + 1),
            c.symbol,
            String(c.score),
            String(c.price),
            `${c.chg1d >= 0 ? "+" : ""}${c.chg1d.toFixed(1)}%`,
            `${c.chg5d >= 0 ? "+" : ""}${c.chg5d.toFixed(1)}%`,
            `${c.volRatio5.toFixed(1)}x`,
            fmtNum(c.bandarValue),
            fmtNum(c.bandarPrev),
            fmtNum(c.bandarAccDist),
            fmtNum(c.smFlow1w),
            c.signals.join(", "),
        ]),
        limit: 30,
    });

    // Regime-aware pick count
    const maxPicks = regime.regime === "AGGRESSIVE" ? 10 : regime.regime === "NORMAL" ? 7 : 3;
    printSubHeader(`DETAILED VIEW — Top ${maxPicks} (regime: ${regime.regime})`);
    for (const c of candidates.slice(0, maxPicks)) {
        const yahooC = candles[c.symbol];
        if (!yahooC) continue;
        console.log(`\n  ${c.symbol} — Score: ${c.score} | ${c.signals.join(", ")}`);
        console.log(`    Price: ${c.price} | 1d: ${c.chg1d.toFixed(1)}% | 3d: ${c.chg3d.toFixed(1)}% | 5d: ${c.chg5d.toFixed(1)}%`);
        console.log(`    Vol: ${c.volRatio5.toFixed(1)}x 5d avg | Trend: ${c.volTrend > 0 ? "expanding" : "flat/contracting"}`);
        console.log(`    Bandar: ${fmtNum(c.bandarValue)} (prev: ${fmtNum(c.bandarPrev)}) | AccDist: ${fmtNum(c.bandarAccDist)}`);
        console.log(`    SM 1d: ${fmtNum(c.smFlow1d)} | SM 1w: ${fmtNum(c.smFlow1w)}`);
        console.log(`    Range pos: ${(c.rangePosition * 100).toFixed(0)}% | CloseNearHigh: ${c.closedNearHigh} | HigherLows: ${c.higher_lows_3d}`);

        // Last 5 candles
        console.log(`    Last 5 candles:`);
        for (const candle of yahooC.slice(-5)) {
            const chg = yahooC.indexOf(candle) > 0
                ? ((candle.close - yahooC[yahooC.indexOf(candle) - 1].close) / yahooC[yahooC.indexOf(candle) - 1].close * 100).toFixed(1)
                : "0.0";
            console.log(`      ${candle.date} | O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} | Vol:${candle.volume} | ${Number(chg) >= 0 ? "+" : ""}${chg}%`);
        }
    }
}

main();
