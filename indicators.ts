import type { DailyCandle } from "./fetchStockPrice.ts";

export interface TechnicalSignals {
    rsi: number;
    macdLine: number;
    macdSignal: number;
    macdHist: number;
    macdCrossoverBarsAgo: number; // -1 if no recent crossover
    bollingerUpper: number;
    bollingerMiddle: number;
    bollingerLower: number;
    touchedLowerBB: boolean; // low <= lowerBB in last 3 candles
    price: number;
    ma50: number;
    volumeMA50: number;
    volume: number;
    score: number;
}

const sma = ({ values, period }: { values: number[]; period: number }): number[] => {
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { result.push(NaN); continue; }
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        result.push(sum / period);
    }
    return result;
};

const ema = ({ values, period }: { values: number[]; period: number }): number[] => {
    const k = 2 / (period + 1);
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) {
            sum += values[i];
            result.push(NaN);
        } else if (i === period - 1) {
            sum += values[i];
            result.push(sum / period);
        } else {
            result.push(values[i] * k + result[i - 1] * (1 - k));
        }
    }
    return result;
};

// Wilder-smoothed RSI
const computeRSI = ({ closes, period = 14 }: { closes: number[]; period?: number }): number[] => {
    const result: number[] = [NaN];
    let avgGain = 0, avgLoss = 0;

    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = Math.max(0, diff);
        const loss = Math.max(0, -diff);

        if (i <= period) {
            avgGain += gain;
            avgLoss += loss;
            if (i < period) { result.push(NaN); continue; }
            avgGain /= period;
            avgLoss /= period;
        } else {
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
        }

        const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        result.push(rsi);
    }
    return result;
};

const computeMACD = ({ closes, fast = 12, slow = 26, signal = 9 }: {
    closes: number[];
    fast?: number;
    slow?: number;
    signal?: number;
}): { line: number[]; signal: number[]; histogram: number[] } => {
    const emaFast = ema({ values: closes, period: fast });
    const emaSlow = ema({ values: closes, period: slow });

    const line = emaFast.map((f, i) =>
        isNaN(f) || isNaN(emaSlow[i]) ? NaN : f - emaSlow[i]
    );

    const validLine = line.filter((v) => !isNaN(v));
    const signalLine = ema({ values: validLine, period: signal });

    // Align signal line back to full array
    const offset = line.length - validLine.length;
    const fullSignal = new Array(offset).fill(NaN).concat(signalLine);
    const histogram = line.map((l, i) =>
        isNaN(l) || isNaN(fullSignal[i]) ? NaN : l - fullSignal[i]
    );

    return { line, signal: fullSignal, histogram };
};

const computeBollinger = ({ closes, period = 20, stdDev = 2 }: {
    closes: number[];
    period?: number;
    stdDev?: number;
}): { upper: number[]; middle: number[]; lower: number[] } => {
    const middle = sma({ values: closes, period });
    const upper: number[] = [];
    const lower: number[] = [];

    for (let i = 0; i < closes.length; i++) {
        if (isNaN(middle[i])) {
            upper.push(NaN);
            lower.push(NaN);
            continue;
        }
        let variance = 0;
        for (let j = i - period + 1; j <= i; j++) {
            variance += (closes[j] - middle[i]) ** 2;
        }
        const sd = Math.sqrt(variance / period);
        upper.push(middle[i] + stdDev * sd);
        lower.push(middle[i] - stdDev * sd);
    }

    return { upper, middle, lower };
};

// Volume EMA5/EMA50 ratio — detects volume expansion vs long-term baseline
// EMA50 barely moves during a 2-3 week spike, so ratio stays elevated throughout
// Takes chronological volumes (oldest-first), returns ratio (>1 = expanding)
export const computeVolumeEMARatio = ({ volumes }: { volumes: number[] }): number => {
    if (volumes.length < 50) return 0;
    const ema5 = ema({ values: volumes, period: 5 });
    const ema50 = ema({ values: volumes, period: 50 });
    const last = volumes.length - 1;
    if (isNaN(ema5[last]) || isNaN(ema50[last]) || ema50[last] === 0) return 0;
    return ema5[last] / ema50[last];
};

// Takes candles (newest-first from API), returns scored signals
export const computeSignals = ({ candles }: { candles: DailyCandle[] }): TechnicalSignals | null => {
    if (candles.length < 50) return null;

    // Reverse to chronological (oldest first)
    const sorted = [...candles].reverse();
    const closes = sorted.map((c) => c.close);
    const lows = sorted.map((c) => c.low);
    const volumes = sorted.map((c) => c.volume);
    const len = closes.length;
    const last = len - 1;

    // RSI
    const rsiArr = computeRSI({ closes });
    const rsi = rsiArr[last];
    if (isNaN(rsi)) return null;

    // MACD
    const macd = computeMACD({ closes });
    const macdLine = macd.line[last];
    const macdSignal = macd.signal[last];
    const macdHist = macd.histogram[last];
    if (isNaN(macdLine) || isNaN(macdSignal)) return null;

    // MACD crossover detection (histogram flips negative → positive in last 3 bars)
    let macdCrossoverBarsAgo = -1;
    for (let i = 0; i < 3; i++) {
        const idx = last - i;
        const prev = idx - 1;
        if (prev < 0) break;
        if (!isNaN(macd.histogram[idx]) && !isNaN(macd.histogram[prev]) &&
            macd.histogram[idx] > 0 && macd.histogram[prev] <= 0) {
            macdCrossoverBarsAgo = i;
            break;
        }
    }

    // Bollinger
    const bb = computeBollinger({ closes });
    const bollingerUpper = bb.upper[last];
    const bollingerMiddle = bb.middle[last];
    const bollingerLower = bb.lower[last];

    // Touched lower BB in last 3 candles
    let touchedLowerBB = false;
    for (let i = 0; i < 3; i++) {
        const idx = last - i;
        if (idx >= 0 && !isNaN(bb.lower[idx]) && lows[idx] <= bb.lower[idx]) {
            touchedLowerBB = true;
            break;
        }
    }

    // MA50 + Volume MA50
    const ma50Arr = sma({ values: closes, period: 50 });
    const ma50 = ma50Arr[last];
    const volMA50Arr = sma({ values: volumes, period: 50 });
    const volumeMA50 = volMA50Arr[last];
    const price = closes[last];
    const volume = volumes[last];

    // Scoring
    let score = 0;
    if (rsi < 30) score += 3;
    else if (rsi < 40) score += 1;
    if (macdCrossoverBarsAgo >= 0) score += 3;
    if (macdLine > macdSignal) score += 1;
    if (touchedLowerBB) score += 2;
    if (!isNaN(ma50) && price > ma50) score += 1;

    return {
        rsi, macdLine, macdSignal, macdHist, macdCrossoverBarsAgo,
        bollingerUpper, bollingerMiddle, bollingerLower, touchedLowerBB,
        price, ma50, volumeMA50, volume, score,
    };
};
