import { fetchGET } from "./utils/fetch.ts";

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

export interface IntradayCandle {
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    value: number;
    frequency: number;
    foreignBuy: number;
    foreignSell: number;
}

// per-DAYS — from/to as "YYYY-MM-DD" (from=newer, to=older)
export const fetchDailyPrice = async ({
    symbol,
    from,
    to,
    limit = 0,
}: {
    symbol: string;
    from: string;
    to: string;
    limit?: number;
}): Promise<DailyCandle[]> => {
    const json = await fetchGET({
        path: `/chartbit/${symbol}/price/daily`,
        params: { from, to, limit: String(limit) },
    });
    const raw = json?.data?.chartbit;
    if (!Array.isArray(raw)) return [];

    return raw.map((c: Record<string, unknown>) => ({
        date: c.date as string,
        open: c.open as number,
        high: c.high as number,
        low: c.low as number,
        close: c.close as number,
        volume: c.volume as number,
        value: c.value as number,
        frequency: c.frequency as number,
        foreignBuy: c.foreignbuy as number,
        foreignSell: c.foreignsell as number,
        foreignFlow: c.foreignflow as number,
        shareOutstanding: c.shareoutstanding as number,
    }));
};

// per-MINUTES — minutesMultiplier: 1 (1m), 5 (5m), 15 (15m)
// per-HOURS   — minutesMultiplier: 60
// from/to as unix timestamps
export const fetchIntradayPrice = async ({
    symbol,
    from,
    to,
    limit = 0,
    minutesMultiplier = 60,
}: {
    symbol: string;
    from: number;
    to: number;
    limit?: number;
    minutesMultiplier?: number;
}): Promise<IntradayCandle[]> => {
    const json = await fetchGET({
        path: `/chartbit/${symbol}/price/intraday`,
        params: { from: String(from), to: String(to), limit: String(limit), minutes_multiplier: String(minutesMultiplier) },
    });
    const raw = json?.data?.chartbit;
    if (!Array.isArray(raw)) return [];

    return raw.map((c: Record<string, unknown>) => ({
        datetime: c.datetime as string,
        open: c.open as number,
        high: c.high as number,
        low: c.low as number,
        close: c.close as number,
        volume: Number(c.volume),
        value: c.value as number,
        frequency: Number(c.frequency),
        foreignBuy: c.foreign_buy as number,
        foreignSell: c.foreign_sell as number,
    }));
};

export const fetchDailyPriceMulti = async ({
    symbols,
    from,
    to,
    limit = 0,
}: {
    symbols: string[];
    from: string;
    to: string;
    limit?: number;
}): Promise<Record<string, DailyCandle[]>> => {
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            try {
                return [symbol, await fetchDailyPrice({ symbol, from, to, limit })] as const;
            } catch {
                return [symbol, []] as const;
            }
        })
    );
    return Object.fromEntries(entries);
};
