/**
 * Position monitor: track open positions against technical levels.
 *
 * Usage: deno task monitor TBIG:1875:1806:1921
 *   Format: SYMBOL:ENTRY:CUTLOSS:TAKEPROFIT
 *
 * Tracks open positions against planned levels + live technicals.
 * Shows distance to SL/TP, momentum health, verdict.
 */

import { fetchYahooDaily, fetchYahooDailyMulti, type YahooCandle } from "./utils/yahooFetch.ts";
import { printHeader, printSubHeader, fmtNum } from "./utils/print.ts";

const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const dim = "\x1b[90m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

// ═══ INDICATORS ═══

const sma = (values: number[], period: number): number => {
    if (values.length < period) return NaN;
    return values.slice(-period).reduce((s, v) => s + v, 0) / period;
};

const smaArray = (values: number[], period: number): number[] => {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        result.push(sum / period);
    }
    return result;
};

const ema = (values: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { sum += values[i]; result.push(NaN); }
        else if (i === period - 1) { sum += values[i]; result.push(sum / period); }
        else result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
};

function computeATR(candles: YahooCandle[], period = 14): number {
    if (candles.length < period + 1) return NaN;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
        const prev = candles[i - 1];
        const tr = Math.max(
            candles[i].high - candles[i].low,
            Math.abs(candles[i].high - prev.close),
            Math.abs(candles[i].low - prev.close),
        );
        sum += tr;
    }
    return sum / period;
}

function computeRSI(closes: number[], period = 14): number {
    if (closes.length < period + 1) return NaN;
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) avgGain += diff; else avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(0, diff)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(0, -diff)) / period;
    }
    return avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
}

function computeMACD(closes: number[]): { line: number; signal: number; hist: number } {
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const macdLine = ema12.map((f, i) => isNaN(f) || isNaN(ema26[i]) ? NaN : f - ema26[i]);
    const validLine = macdLine.filter(v => !isNaN(v));
    const signalLine = ema(validLine, 9);
    const last = validLine.length - 1;
    const line = validLine[last] ?? NaN;
    const signal = signalLine[last] ?? NaN;
    return { line, signal, hist: line - signal };
}

function findSwingLevels(candles: YahooCandle[], lookback = 30): { swingHighs: { price: number; date: string }[]; swingLows: { price: number; date: string }[] } {
    const recent = candles.slice(-lookback);
    const swingHighs: { price: number; date: string }[] = [];
    const swingLows: { price: number; date: string }[] = [];
    for (let i = 2; i < recent.length - 2; i++) {
        if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i - 2].high &&
            recent[i].high > recent[i + 1].high && recent[i].high > recent[i + 2].high) {
            swingHighs.push({ price: recent[i].high, date: recent[i].date });
        }
        if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i - 2].low &&
            recent[i].low < recent[i + 1].low && recent[i].low < recent[i + 2].low) {
            swingLows.push({ price: recent[i].low, date: recent[i].date });
        }
    }
    return { swingHighs, swingLows };
}

// ═══ ANALYSIS ═══

interface PositionAnalysis {
    symbol: string;
    entry: number;
    cutLoss: number;
    tp: number;
    current: number;
    pnl: number;
    atr: number;
    rsi: number;
    macd: { line: number; signal: number; hist: number };
    bollinger: { upper: number; mid: number; lower: number };
    volRatio: number;
    swingHighs: { price: number; date: string }[];
    swingLows: { price: number; date: string }[];
    distToSL: number;    // % distance to cut loss
    distToTP: number;    // % distance to take profit
    verdict: string;
    reasons: string[];
}

function analyzePosition(symbol: string, entry: number, cutLoss: number, tp: number, candles: YahooCandle[]): PositionAnalysis {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const last = candles.length - 1;
    const current = candles[last].close;
    const pnl = (current - entry) / entry * 100;

    const atr = computeATR(candles);
    const rsi = computeRSI(closes);
    const macd = computeMACD(closes);

    const sma20 = smaArray(closes, 20);
    const mid = sma20[last];
    let std = 0;
    for (let i = last - 19; i <= last; i++) std += (closes[i] - mid) ** 2;
    std = Math.sqrt(std / 20);
    const bollinger = { upper: mid + 2 * std, mid, lower: mid - 2 * std };

    const avgVol5 = sma(volumes.slice(-6, -1), 5);
    const volRatio = avgVol5 > 0 ? volumes[last] / avgVol5 : 1;

    const { swingHighs, swingLows } = findSwingLevels(candles);

    // Distance to planned levels
    const distToSL = (current - cutLoss) / current * 100;
    const distToTP = (tp - current) / current * 100;

    // Verdict
    const reasons: string[] = [];
    let score = 0;

    // Momentum
    if (rsi > 70) { score -= 2; reasons.push(`RSI ${rsi.toFixed(0)} overbought`); }
    else if (rsi > 60) { score -= 1; reasons.push(`RSI ${rsi.toFixed(0)} warm`); }
    else if (rsi < 30) { score += 2; reasons.push(`RSI ${rsi.toFixed(0)} oversold`); }
    else { reasons.push(`RSI ${rsi.toFixed(0)} neutral`); }

    if (macd.hist > 0 && macd.line > 0) { score += 1; reasons.push("MACD bullish"); }
    else if (macd.hist < 0 && macd.line < 0) { score -= 1; reasons.push("MACD bearish"); }
    else if (macd.hist < 0) { score -= 1; reasons.push("MACD hist fading"); }

    if (current > bollinger.upper) { score -= 2; reasons.push("above BB upper — stretched"); }
    else if (current > bollinger.mid + std) { score -= 1; reasons.push("near BB upper"); }
    else if (current < bollinger.lower) { score += 1; reasons.push("below BB lower — oversold"); }

    if (volRatio > 2) { reasons.push(`vol ${volRatio.toFixed(1)}x expanding`); }
    else if (volRatio < 0.5) { score -= 1; reasons.push(`vol ${volRatio.toFixed(1)}x dying`); }

    if (pnl < -3) { score -= 2; reasons.push(`underwater ${pnl.toFixed(1)}%`); }
    else if (pnl > 3) { score += 1; reasons.push(`profit ${pnl.toFixed(1)}%`); }

    // Proximity to planned levels
    if (current <= cutLoss) { score -= 3; reasons.push("HIT CUT LOSS"); }
    else if (distToSL < 1.5) { score -= 1; reasons.push(`${distToSL.toFixed(1)}% to SL — danger`); }
    if (current >= tp) { score += 1; reasons.push("HIT TAKE PROFIT"); }
    else if (distToTP < 1) { reasons.push(`${distToTP.toFixed(1)}% to TP — close`); }

    let verdict: string;
    if (current <= cutLoss) verdict = "CUT LOSS NOW";
    else if (score <= -3) verdict = "SELL — weakness accumulating";
    else if (current >= tp) verdict = "TAKE PROFIT";
    else if (score >= 2) verdict = "HOLD — momentum intact";
    else if (score >= 0) verdict = "HOLD — neutral, watch closely";
    else verdict = "HOLD — caution, tighten stop";

    return {
        symbol, entry, cutLoss, tp, current, pnl, atr, rsi, macd, bollinger, volRatio,
        swingHighs, swingLows, distToSL, distToTP, verdict, reasons,
    };
}

// ═══ MAIN ═══

async function main() {
    const args = Deno.args;
    if (args.length === 0) {
        console.log("Usage: deno task monitor TBIG:1875:1806:1921");
        console.log("  Format: SYMBOL:ENTRY:CUTLOSS:TAKEPROFIT");
        Deno.exit(1);
    }

    const positions = args.map(a => {
        const parts = a.split(":");
        return {
            symbol: parts[0].toUpperCase(),
            entry: Number(parts[1]),
            cutLoss: Number(parts[2]),
            tp: Number(parts[3]),
        };
    }).filter(p => p.symbol && !isNaN(p.entry) && !isNaN(p.cutLoss) && !isNaN(p.tp));

    if (positions.length === 0) {
        console.log("No valid positions. Format: SYMBOL:ENTRY:CUTLOSS:TAKEPROFIT");
        Deno.exit(1);
    }

    printHeader("POSITION MONITOR");

    // Fetch IHSG for context
    const ihsgCandles = await fetchYahooDaily({ symbol: "^JKSE", days: 30 });
    const ihsgLast = ihsgCandles[ihsgCandles.length - 1];
    const ihsgPrev = ihsgCandles[ihsgCandles.length - 2];
    const ihsgChg = (ihsgLast.close - ihsgPrev.close) / ihsgPrev.close * 100;
    const ihsgChg5d = ihsgCandles.length >= 6
        ? (ihsgLast.close - ihsgCandles[ihsgCandles.length - 6].close) / ihsgCandles[ihsgCandles.length - 6].close * 100
        : 0;

    console.log(`  IHSG: ${ihsgLast.close.toFixed(0)} | Last: ${ihsgChg >= 0 ? "+" : ""}${ihsgChg.toFixed(1)}% | 5d: ${ihsgChg5d >= 0 ? "+" : ""}${ihsgChg5d.toFixed(1)}% | Date: ${ihsgLast.date}\n`);

    // Fetch candles for all positions
    const symbols = positions.map(p => p.symbol);
    const allCandles = await fetchYahooDailyMulti({ symbols, days: 90 });

    for (const pos of positions) {
        const candles = allCandles[pos.symbol];
        if (!candles || candles.length < 30) {
            console.log(`  ${pos.symbol}: insufficient data (${candles?.length ?? 0} candles)`);
            continue;
        }

        const a = analyzePosition(pos.symbol, pos.entry, pos.cutLoss, pos.tp, candles);

        const pnlCol = a.pnl > 0 ? green : a.pnl < -1 ? red : yellow;
        const verdictCol = a.verdict.startsWith("CUT") ? red :
            a.verdict.startsWith("SELL") ? red :
            a.verdict.startsWith("TAKE") ? green : yellow;

        printSubHeader(`${a.symbol} — Entry: ${a.entry} | Now: ${a.current} | ${pnlCol}${a.pnl >= 0 ? "+" : ""}${a.pnl.toFixed(2)}%${reset}`);

        console.log(`  ${verdictCol}${bold}>>> ${a.verdict} <<<${reset}\n`);

        // Levels with distance
        const slCol = a.distToSL < 2 ? red : dim;
        const tpCol = a.distToTP < 2 ? green : dim;
        console.log("  PLANNED LEVELS:");
        console.log(`    ${green}Take Profit: ${a.tp}${reset}  ${tpCol}(${a.distToTP >= 0 ? "+" : ""}${a.distToTP.toFixed(1)}% away)${reset}`);
        console.log(`    ${bold}Current:     ${a.current}${reset}`);
        console.log(`    Entry:       ${a.entry}  ${dim}(P&L: ${a.pnl >= 0 ? "+" : ""}${a.pnl.toFixed(2)}%)${reset}`);
        console.log(`    ${red}Cut Loss:    ${a.cutLoss}${reset}  ${slCol}(${a.distToSL.toFixed(1)}% away)${reset}`);

        // Risk/Reward from current price
        const risk = a.current - a.cutLoss;
        const reward = a.tp - a.current;
        const rr = risk > 0 ? reward / risk : 0;
        console.log(`    R:R from here: ${reward.toFixed(0)}:${risk.toFixed(0)} = ${rr.toFixed(2)}`);

        // Swing levels
        const nearSup = a.swingLows.filter(s => s.price < a.current).sort((x, y) => y.price - x.price).slice(0, 2);
        const nearRes = a.swingHighs.filter(s => s.price > a.current).sort((x, y) => x.price - y.price).slice(0, 2);
        if (nearSup.length > 0 || nearRes.length > 0) {
            console.log(`\n  SWING LEVELS:`);
            for (const r of nearRes.reverse()) console.log(`    ${dim}Resistance: ${r.price} (${r.date})${reset}`);
            console.log(`    ${bold}>>> ${a.current} <<<${reset}`);
            for (const s of nearSup) console.log(`    ${dim}Support:    ${s.price} (${s.date})${reset}`);
        }

        // Indicators
        console.log(`\n  INDICATORS:`);
        console.log(`    ATR(14): ${a.atr.toFixed(0)} | RSI(14): ${a.rsi.toFixed(1)} | Vol: ${a.volRatio.toFixed(1)}x avg`);
        console.log(`    MACD: line ${a.macd.line.toFixed(1)} signal ${a.macd.signal.toFixed(1)} hist ${a.macd.hist >= 0 ? "+" : ""}${a.macd.hist.toFixed(1)}`);
        console.log(`    BB(20,2): ${a.bollinger.lower.toFixed(0)} / ${a.bollinger.mid.toFixed(0)} / ${a.bollinger.upper.toFixed(0)}`);

        // Last 5 candles
        console.log(`\n  LAST 5 CANDLES:`);
        for (const c of candles.slice(-5)) {
            const i = candles.indexOf(c);
            const chg = i > 0 ? (c.close - candles[i - 1].close) / candles[i - 1].close * 100 : 0;
            const col = chg > 0 ? green : chg < 0 ? red : dim;
            console.log(`    ${col}${c.date} O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${(c.volume / 1e6).toFixed(1)}M ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%${reset}`);
        }

        // Signals
        console.log(`\n  SIGNALS: ${a.reasons.join(" | ")}`);
    }
}

main();
