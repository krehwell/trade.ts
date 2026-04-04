import { TOKEN } from "./constants.ts";

const BASE = "https://exodus.stockbit.com";

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
    const url = `${BASE}/chartbit/${symbol}/price/daily?from=${from}&to=${to}&limit=${limit}`;
    const res = await fetch(url, {
        headers: { Authorization: TOKEN },
    });
    const json = await res.json();
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
    const url = `${BASE}/chartbit/${symbol}/price/intraday?from=${from}&to=${to}&limit=${limit}&minutes_multiplier=${minutesMultiplier}`;
    const res = await fetch(url, {
        headers: { Authorization: TOKEN },
    });
    const json = await res.json();
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
    delay = 300,
}: {
    symbols: string[];
    from: string;
    to: string;
    limit?: number;
    delay?: number;
}): Promise<Record<string, DailyCandle[]>> => {
    const result: Record<string, DailyCandle[]> = {};
    for (const symbol of symbols) {
        try {
            result[symbol] = await fetchDailyPrice({ symbol, from, to, limit });
        } catch {
            result[symbol] = [];
        }
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    return result;
};
