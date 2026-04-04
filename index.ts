import { fetchBrokerActivity, fetchBrokerActivityMultiTF, fetchTopBrokers, type StockFlow } from "./fetchBrokerActivity.ts";
import { fetchScreenerAll } from "./fetchScreener.ts";
import { fetchDailyPriceMulti, type DailyCandle } from "./fetchStockPrice.ts";
import { computeSignals, computeVolumeEMARatio } from "./indicators.ts";
import { ITEMS } from "./screenerItems.ts";
import {
    fmtNum,
    fmtPrice,
    printFlowSummary,
    printHeader,
    printSubHeader,
    printTable,
} from "./print.ts";

// Smart money brokers — global investment banks + top institutional
const SMART_MONEY_BROKERS = ["MS", "BK", "CS", "CG", "GW", "KZ", "RX", "DP", "AK", "ZP", "LG", "TP", "KI", "HP"];

const fmt = (d: Date): string => d.toISOString().slice(0, 10);
const today = () => fmt(new Date());
const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return fmt(d);
};

// Shared candle cache — flowA fetches 120d, flowB reuses for overlapping stocks
const candleCache: Record<string, DailyCandle[]> = {};

const fetchCandlesCached = async ({ symbols, from, to }: {
    symbols: string[];
    from: string;
    to: string;
}): Promise<Record<string, DailyCandle[]>> => {
    const uncached = symbols.filter((s) => !candleCache[s]);
    if (uncached.length > 0) {
        console.log(`  Fetching candles for ${uncached.length} stocks (~${Math.ceil(uncached.length * 0.3)}s)...`);
        const fresh = await fetchDailyPriceMulti({ symbols: uncached, from, to });
        Object.assign(candleCache, fresh);
    } else {
        console.log(`  All ${symbols.length} stocks cached`);
    }
    const result: Record<string, DailyCandle[]> = {};
    for (const s of symbols) result[s] = candleCache[s] ?? [];
    return result;
};

// FLOW A — Technical & Price Action filter
// Score-based: RSI<30 (+3), RSI 30-40 (+1), MACD crossover (+3), MACD line>signal (+1),
// touched lower BB (+2), volume>MA50 (+1), price>MA50 (+1). Minimum score: 4
const flowA = async (): Promise<string[]> => {
    printSubHeader("Flow A — Technical screening");

    const stocks = await fetchScreenerAll({
        filters: [
            { id: ITEMS.PRICE, operator: ">", value: 50 },
            { id: ITEMS.VALUE_MA50, operator: ">", value: 1_000_000_000 },
            { id: ITEMS.EPS_TTM, operator: ">", value: 0 },
            { id: ITEMS.RETURNS_3M, operator: "<", value: 0 },
        ],
    });
    console.log(`  Screener: ${stocks.length} candidates (liquid+profitable+declining)`);
    if (stocks.length === 0) return [];

    const symbols = stocks.map((s) => s.symbol);
    const allCandles = await fetchCandlesCached({
        symbols,
        from: today(),
        to: daysAgo(120),
    });

    const results: { symbol: string; score: number; rsi: number; macdX: number; bb: boolean; price: number }[] = [];

    for (const sym of symbols) {
        const candles = allCandles[sym];
        if (!candles || candles.length < 50) continue;
        const sig = computeSignals({ candles });
        if (!sig || sig.score < 4) continue;
        results.push({
            symbol: sym,
            score: sig.score,
            rsi: sig.rsi,
            macdX: sig.macdCrossoverBarsAgo,
            bb: sig.touchedLowerBB,
            price: sig.price,
        });
    }

    results.sort((a, b) => b.score - a.score || a.rsi - b.rsi);

    printSubHeader(`Flow A Results (${results.length} stocks, score >= 4)`);
    if (results.length > 0) {
        printTable({
            columns: [
                { label: "#", width: 4, align: "right" },
                { label: "Stock", width: 8 },
                { label: "Score", width: 6, align: "right" },
                { label: "RSI", width: 6, align: "right" },
                { label: "MACD-X", width: 7, align: "right" },
                { label: "BB-Low", width: 7 },
                { label: "Price", width: 10, align: "right" },
            ],
            rows: results.map((r, i) => [
                String(i + 1),
                r.symbol,
                String(r.score),
                r.rsi.toFixed(1),
                r.macdX >= 0 ? `${r.macdX}d` : "-",
                r.bb ? "YES" : "-",
                fmtPrice(r.price),
            ]),
            limit: 30,
        });
    } else {
        console.log("  No stocks passed technical filter.");
    }

    return results.map((r) => r.symbol);
};

// FLOW B — Broker-centric Smart Money filter
// Score: SM 1w net buy (+5), vol EMA5/EMA50 >1.5 (+4) or >1.2 (+2), retail 1w selling (+2),
// all-3-TF consistency (+1), candle foreign 7d confirm (+1). Minimum: 4
// 1d and 1m SM flow shown but not scored individually.
const flowB = async (): Promise<string[]> => {
    printSubHeader("Flow B — Smart Money broker activity");

    // Step 1: Screener for liquid universe
    const stocks = await fetchScreenerAll({
        filters: [
            { id: ITEMS.PRICE, operator: ">", value: 50 },
            { id: ITEMS.VALUE_MA50, operator: ">", value: 1_000_000_000 },
        ],
    });
    const universe = new Set(stocks.map((s) => s.symbol));
    console.log(`  Universe: ${universe.size} liquid stocks`);

    // Step 2: Fetch smart money broker activity across 3 timeframes
    console.log(`  Fetching SM broker activity (${SMART_MONEY_BROKERS.length} brokers × 3 TFs)...`);
    const smFlows = await fetchBrokerActivityMultiTF({
        brokers: SMART_MONEY_BROKERS,
        date: today(),
        timeframes: ["1d", "1w", "1m"],
    });

    // Step 3: Fetch top retail brokers and their 1w activity
    console.log("  Fetching retail broker activity (1w)...");
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

    // Step 4: Get all stocks that appear in any SM timeframe, filtered to liquid universe
    const allSymbols = [...new Set([
        ...Object.keys(smFlows["1d"] ?? {}),
        ...Object.keys(smFlows["1w"] ?? {}),
        ...Object.keys(smFlows["1m"] ?? {}),
    ])].filter((s) => universe.has(s));

    // Step 5: Fetch candles for volume EMA5/EMA50 + foreign flow confirm
    const allCandles = await fetchCandlesCached({
        symbols: allSymbols,
        from: today(),
        to: daysAgo(120),
    });

    const results: {
        symbol: string;
        score: number;
        sm1d: number;
        sm1w: number;
        sm1m: number;
        retail1w: number;
        volRatio: number;
        fgn7d: number;
    }[] = [];

    for (const sym of allSymbols) {
        const sm1d = smFlows["1d"]?.[sym] ?? 0;
        const sm1w = smFlows["1w"]?.[sym] ?? 0;
        const sm1m = smFlows["1m"]?.[sym] ?? 0;
        const retail1w = retailFlow1w[sym] ?? 0;

        // Net foreign buy/sell over 7 trading days from candles
        const candles = allCandles[sym];
        let fgn7d = 0;
        if (candles && candles.length >= 7) {
            fgn7d = candles.slice(0, 7).reduce((s, c) => s + (c.foreignBuy - c.foreignSell), 0);
        }

        // Filter: must have net foreign > 100M in 7 days
        if (fgn7d < 100_000_000) continue;

        // Volume EMA5/EMA50 ratio — sustained volume expansion vs long-term baseline
        const volRatio = candles && candles.length >= 50
            ? computeVolumeEMARatio({ volumes: [...candles].reverse().map((c) => c.volume) })
            : 0;

        let score = 0;
        // 1w SM accumulation — primary signal
        if (sm1w > 0) score += 5;
        // Volume expansion (EMA5/EMA20 ratio)
        if (volRatio > 1.5) score += 4;
        else if (volRatio > 1.2) score += 2;
        // Retail selling while SM buying — divergence
        if (retail1w < 0) score += 2;
        // Cross-TF consistency: all 3 positive
        if (sm1d > 0 && sm1w > 0 && sm1m > 0) score += 1;
        // Candle foreign flow confirmation
        if (fgn7d > 0) score += 1;

        if (score >= 4) {
            results.push({ symbol: sym, score, sm1d, sm1w, sm1m, retail1w, volRatio, fgn7d });
        }
    }

    results.sort((a, b) => b.score - a.score || b.sm1w - a.sm1w);

    printSubHeader(`Flow B Results (${results.length} stocks, score >= 4)`);
    if (results.length > 0) {
        printTable({
            columns: [
                { label: "#", width: 4, align: "right" },
                { label: "Stock", width: 8 },
                { label: "Score", width: 6, align: "right" },
                { label: "SM 1w", width: 12, align: "right" },
                { label: "SM 1d", width: 12, align: "right" },
                { label: "SM 1m", width: 12, align: "right" },
                { label: "Fgn 7d", width: 12, align: "right" },
                { label: "Ret 1w", width: 12, align: "right" },
                { label: "VolR", width: 6, align: "right" },
            ],
            rows: results.map((r, i) => [
                String(i + 1),
                r.symbol,
                String(r.score),
                fmtNum(r.sm1w),
                fmtNum(r.sm1d),
                fmtNum(r.sm1m),
                fmtNum(r.fgn7d),
                fmtNum(r.retail1w),
                r.volRatio > 0 ? `${r.volRatio.toFixed(1)}x` : "-",
            ]),
            limit: 30,
        });
    } else {
        console.log("  No stocks with smart money accumulation.");
    }

    return results.map((r) => r.symbol);
};

async function main() {
    printHeader(`IDX STOCK SCANNER — ${today()}`);

    // Sequential — both flows hit the same rate-limited candle API
    const stocksA = await flowA();
    const stocksB = await flowB();

    const setBOfSyms = new Set(stocksB);
    const intersection = stocksA
        .filter((s) => setBOfSyms.has(s))
        .map((s) => ({
            symbol: s,
            rankA: stocksA.indexOf(s) + 1,
            rankB: stocksB.indexOf(s) + 1,
        }))
        .sort((a, b) => (a.rankA + a.rankB) - (b.rankA + b.rankB));
    printFlowSummary({ a: stocksA, b: stocksB, intersection });
}

main();
