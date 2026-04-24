import { fetchYahooDaily } from "./utils/yahooFetch.ts";

export interface DailyCandle {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    value: number;
    frequency: number;
    foreignBuy: number;
    foreignSell: number;
    foreignFlow: number;
    shareOutstanding: number;
}

// from/to as "YYYY-MM-DD" — from=newer date, to=older date (kept for compat)
// Under the hood uses Yahoo Finance since chartbit is paywalled
export const fetchDailyPrice = async ({
    symbol,
    from,
    to,
}: {
    symbol: string;
    from: string;
    to: string;
    limit?: number;
}): Promise<DailyCandle[]> => {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days =
        Math.ceil((fromDate.getTime() - toDate.getTime()) / 86_400_000) + 1;

    const yahooCandles = await fetchYahooDaily({ symbol, days });
    if (yahooCandles.length === 0) return [];

    // Yahoo returns oldest-first; reverse to newest-first (matching old chartbit behavior)
    return yahooCandles.reverse().map((c) => ({
        date: c.date,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        value: 0,
        frequency: 0,
        foreignBuy: 0,
        foreignSell: 0,
        foreignFlow: 0,
        shareOutstanding: 0,
    }));
};

export const fetchDailyPriceMulti = async ({
    symbols,
    from,
    to,
}: {
    symbols: string[];
    from: string;
    to: string;
    limit?: number;
}): Promise<Record<string, DailyCandle[]>> => {
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            try {
                return [
                    symbol,
                    await fetchDailyPrice({ symbol, from, to }),
                ] as const;
            } catch {
                return [symbol, []] as const;
            }
        }),
    );
    return Object.fromEntries(entries);
};
