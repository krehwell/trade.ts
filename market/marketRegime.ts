import { fetchDaily as fetchYahooDaily } from "../data/stockbitCandles.ts";
import { type YahooCandle } from "../data/yahooCandles.ts";
import { avgVolume, distPct, maSlope, pctChange, sma } from "./indicators.ts";
import { fetchScreener } from "../data/fetchScreener.ts";
import { ITEMS } from "../data/screenerItems.ts";
import { printSubHeader } from "../util/print.ts";

export type Regime = "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "SIT_OUT";

export interface RegimeResult {
    regime: Regime;
    score: number;       // -10 to +10, negative = bearish
    ihsg: {
        close: number;
        chg1d: number;
        chg3d: number;
        chg5d: number;
        ma5: number;
        ma10: number;
        ma20: number;
        aboveMa5: boolean;
        aboveMa10: boolean;
        aboveMa20: boolean;
        ma5Slope: number;  // % change in MA5 over 3 days
        ma10Slope: number; // % change in MA10 over 3 days
        distMa20: number;  // % distance of close from MA20
        vol1d: number;
        avgVol5: number;
        volRatio: number;
    };
    breadth: {
        bandarBuying: number;   // count of stocks with bandar > 0
        bandarSelling: number;  // count with bandar < 0
        ratio: number;          // buying / (buying + selling)
        totalLiquid: number;    // total liquid stocks
    };
    signals: string[];
    lastTradingDate: string; // ISO date of last IHSG candle. Anchor flow windows here, not today()
}

export const detectRegime = async (): Promise<RegimeResult> => {
    const signals: string[] = [];
    let score = 0;

    // 1. IHSG trend via Yahoo (^JKSE)
    const ihsgCandles = await fetchYahooDaily({ symbol: "^JKSE", days: 40 });
    if (ihsgCandles.length < 20) {
        return {
            regime: "SIT_OUT",
            score: -10,
            ihsg: { close: 0, chg1d: 0, chg3d: 0, chg5d: 0, ma5: 0, ma10: 0, ma20: 0, aboveMa5: false, aboveMa10: false, aboveMa20: false, ma5Slope: 0, ma10Slope: 0, distMa20: 0, vol1d: 0, avgVol5: 0, volRatio: 0 },
            breadth: { bandarBuying: 0, bandarSelling: 0, ratio: 0, totalLiquid: 0 },
            signals: ["NO_DATA"],
            lastTradingDate: "",
        };
    }

    const closes = ihsgCandles.map(c => c.close);
    const volumes = ihsgCandles.map(c => c.volume);
    const last = ihsgCandles.length - 1;
    const t = ihsgCandles[last];
    const y = ihsgCandles[last - 1];

    const chg1d = pctChange(y.close, t.close);
    const chg3d = last >= 3 ? pctChange(ihsgCandles[last - 3].close, t.close) : 0;
    const chg5d = last >= 5 ? pctChange(ihsgCandles[last - 5].close, t.close) : 0;

    const ma5 = sma(closes, 5);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);

    // MA slopes: compare current to 3 days ago
    const ma5Slope = maSlope(closes, 5, 3);
    const ma10Slope = maSlope(closes, 10, 3);
    const distMa20 = distPct(t.close, ma20);
    const chg10d = last >= 10 ? pctChange(ihsgCandles[last - 10].close, t.close) : 0;

    const aboveMa5 = t.close > ma5;
    const aboveMa10 = t.close > ma10;
    const aboveMa20 = t.close > ma20;

    const avgVol5 = avgVolume(volumes, 5, true); // exclude today
    const volRatio = avgVol5 > 0 ? t.volume / avgVol5 : 1;

    // IHSG scoring
    // Today's change
    if (chg1d > 0.5) { score += 2; signals.push(`IHSG +${chg1d.toFixed(1)}% today`); }
    else if (chg1d > 0) { score += 1; signals.push(`IHSG +${chg1d.toFixed(1)}%`); }
    else if (chg1d > -0.5) { score -= 1; signals.push(`IHSG ${chg1d.toFixed(1)}%`); }
    else if (chg1d > -1.5) { score -= 2; signals.push(`IHSG ${chg1d.toFixed(1)}% WEAK`); }
    else { score -= 3; signals.push(`IHSG ${chg1d.toFixed(1)}% SELLOFF`); }

    // 3d trend
    if (chg3d > 1) { score += 1; signals.push("3d trend UP"); }
    else if (chg3d < -1) { score -= 1; signals.push("3d trend DOWN"); }

    // 5d trend
    if (chg5d > 2) { score += 1; signals.push("5d trend UP"); }
    else if (chg5d < -2) { score -= 1; signals.push("5d trend DOWN"); }

    // MA alignment
    if (aboveMa5 && aboveMa10 && aboveMa20) { score += 2; signals.push("above all MAs"); }
    else if (!aboveMa5 && !aboveMa10 && !aboveMa20) { score -= 2; signals.push("below all MAs"); }
    else if (aboveMa20 && !aboveMa5) { score -= 1; signals.push("pulling back to MAs"); }

    // MA5 slope (short term momentum direction)
    if (ma5Slope > 0.3) { score += 1; signals.push("MA5 rising"); }
    else if (ma5Slope < -0.3) { score -= 1; signals.push("MA5 falling"); }

    // Selloff on high volume = worse
    if (chg1d < -1 && volRatio > 1.5) { score -= 1; signals.push("high vol selloff"); }
    // Rally on high volume = better
    if (chg1d > 0.5 && volRatio > 1.5) { score += 1; signals.push("high vol rally"); }

    // 2. Market breadth via screener (bandar buying vs selling as proxy)
    const [buyingRes, sellingRes, liquidRes] = await Promise.all([
        fetchScreener({
            filters: [
                { id: ITEMS.PRICE, operator: ">", value: 50 },
                { id: ITEMS.VALUE_MA50, operator: ">", value: 500_000_000 },
                { id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 },
            ],
        }),
        fetchScreener({
            filters: [
                { id: ITEMS.PRICE, operator: ">", value: 50 },
                { id: ITEMS.VALUE_MA50, operator: ">", value: 500_000_000 },
                { id: ITEMS.BANDAR_VALUE, operator: "<", value: 0 },
            ],
        }),
        fetchScreener({
            filters: [
                { id: ITEMS.PRICE, operator: ">", value: 50 },
                { id: ITEMS.VALUE_MA50, operator: ">", value: 500_000_000 },
            ],
        }),
    ]);

    const bandarBuying = buyingRes.totalRows;
    const bandarSelling = sellingRes.totalRows;
    const totalLiquid = liquidRes.totalRows;
    const breadthRatio = (bandarBuying + bandarSelling) > 0
        ? bandarBuying / (bandarBuying + bandarSelling)
        : 0.5;

    // Breadth scoring
    if (breadthRatio > 0.6) { score += 2; signals.push(`breadth ${(breadthRatio * 100).toFixed(0)}% buying`); }
    else if (breadthRatio > 0.5) { score += 1; signals.push(`breadth ${(breadthRatio * 100).toFixed(0)}% buying`); }
    else if (breadthRatio < 0.3) { score -= 2; signals.push(`breadth ${(breadthRatio * 100).toFixed(0)}% buying - BEARISH`); }
    else if (breadthRatio < 0.4) { score -= 1; signals.push(`breadth ${(breadthRatio * 100).toFixed(0)}% buying - weak`); }

    // Map the cumulative score to a regime band (higher = more risk on).
    let regime: Regime;
    if (score >= 5) regime = "AGGRESSIVE";
    else if (score >= 1) regime = "NORMAL";
    else if (score >= -3) regime = "DEFENSIVE";
    else regime = "SIT_OUT";

    // TRAP FILTER 1: dead cat bounce.  Price deep below MA20 while MA10 still falling.
    if (distMa20 < -3 && ma10Slope < 0 && regime !== "SIT_OUT") {
        signals.push("TRAP: dead cat bounce (below MA20 + MA10 falling)");
        regime = "SIT_OUT";
    }

    // TRAP FILTER 2: exhaustion.  Big 10d run capped by a negative day = topping.
    if (chg10d > 7 && chg1d < 0 && regime !== "SIT_OUT") {
        signals.push("TRAP: exhaustion (10d run + negative day)");
        regime = "DEFENSIVE";
    }

    return {
        regime,
        score,
        ihsg: {
            close: t.close, chg1d, chg3d, chg5d,
            ma5, ma10, ma20,
            aboveMa5, aboveMa10, aboveMa20,
            ma5Slope, ma10Slope, distMa20,
            vol1d: t.volume, avgVol5, volRatio,
        },
        breadth: { bandarBuying, bandarSelling, ratio: breadthRatio, totalLiquid },
        signals,
        lastTradingDate: t.date,
    };
};

export const printRegime = (r: RegimeResult) => {
    printSubHeader("MARKET REGIME");

    const regimeColors: Record<Regime, string> = {
        AGGRESSIVE: "\x1b[32m",  // green
        NORMAL: "\x1b[33m",      // yellow
        DEFENSIVE: "\x1b[31m",   // red
        SIT_OUT: "\x1b[41m\x1b[37m", // red bg white text
    };
    const reset = "\x1b[0m";

    console.log(`  ${regimeColors[r.regime]}>>> ${r.regime} (score: ${r.score}) <<<${reset}`);
    console.log();

    console.log(`  IHSG: ${r.ihsg.close.toFixed(0)}`);
    console.log(`    Today: ${r.ihsg.chg1d >= 0 ? "+" : ""}${r.ihsg.chg1d.toFixed(2)}% | 3d: ${r.ihsg.chg3d >= 0 ? "+" : ""}${r.ihsg.chg3d.toFixed(2)}% | 5d: ${r.ihsg.chg5d >= 0 ? "+" : ""}${r.ihsg.chg5d.toFixed(2)}%`);
    console.log(`    MA5: ${r.ihsg.ma5.toFixed(0)} ${r.ihsg.aboveMa5 ? "ABOVE" : "BELOW"} | MA10: ${r.ihsg.ma10.toFixed(0)} ${r.ihsg.aboveMa10 ? "ABOVE" : "BELOW"} | MA20: ${r.ihsg.ma20.toFixed(0)} ${r.ihsg.aboveMa20 ? "ABOVE" : "BELOW"}`);
    console.log(`    MA5 slope: ${r.ihsg.ma5Slope >= 0 ? "+" : ""}${r.ihsg.ma5Slope.toFixed(2)}% | Vol: ${r.ihsg.volRatio.toFixed(1)}x avg`);

    console.log(`  Breadth: ${r.breadth.bandarBuying} buying / ${r.breadth.bandarSelling} selling (${(r.breadth.ratio * 100).toFixed(0)}% buy) of ${r.breadth.totalLiquid} liquid`);
    console.log(`  Signals: ${r.signals.join(" | ")}`);

    // Action the trader should take for this regime.
    console.log();
    switch (r.regime) {
        case "AGGRESSIVE":
            console.log("  Action: Full 7 picks, favor momentum runners");
            break;
        case "NORMAL":
            console.log("  Action: 5-7 picks, focus on highest-score candidates only");
            break;
        case "DEFENSIVE":
            console.log("  Action: Max 3 picks, only extreme-confidence setups, half size");
            break;
        case "SIT_OUT":
            console.log("  Action: NO TRADES TODAY. Market is hostile to overnight holds.");
            break;
    }
    console.log();
};
