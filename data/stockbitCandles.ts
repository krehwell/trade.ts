import { fetchGET } from "../net/stockbitFetch.ts";
import {
    type Candle,
    fetchCandles as fetchYahooCandles,
    fetchYahooDaily,
    type YahooCandle,
} from "./yahooCandles.ts";

// Stockbit first candle fetchers (near realtime via chartbit), with Yahoo fallback
// when Stockbit is empty/errors or for index symbols (^JKSE etc).  Drop in replacements
// for the equally named yahooCandles functions, with identical return shapes.

const DAY_MS = 86_400_000;
const rangeToDays = (range: string) => parseInt(range, 10) || 30;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Yahoo wants "BBCA.JK"; chartbit wants the bare ticker "BBCA".
const bareTicker = (symbol: string) => symbol.replace(/\.jk$/i, "").toUpperCase();

// Raw chartbit daily rows (newest first), or [] if no data / error.
const rawDaily = async (symbol: string, days: number): Promise<Record<string, unknown>[]> => {
    const now = Date.now();
    const json = await fetchGET({
        path: `/chartbit/${bareTicker(symbol)}/price/daily`,
        // chartbit quirk: from=newer date, to=older date
        params: { from: ymd(now), to: ymd(now - days * DAY_MS), limit: "0" },
    });
    const raw = json?.data?.chartbit;
    return Array.isArray(raw) ? raw : [];
};

const fetchStockbitDaily = async (symbol: string, days: number): Promise<Candle[]> => {
    const raw = await rawDaily(symbol, days);
    return raw
        .map((c): Candle => ({
            // c.unixdate is 00:00 WIB -> previous UTC day; anchor to the calendar
            // day at 00:00Z so day labels match Yahoo's daily candles.
            date: Date.parse(`${c.date}T00:00:00Z`) / 1000,
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume),
        }))
        .reverse(); // chartbit is newest first; match Yahoo's oldest first
};

const fetchStockbitIntraday = async (symbol: string, days: number, minutes: number): Promise<Candle[]> => {
    const now = Math.floor(Date.now() / 1000);
    const json = await fetchGET({
        path: `/chartbit/${bareTicker(symbol)}/price/intraday`,
        params: {
            from: String(now),
            to: String(now - days * 86400),
            limit: "0",
            minutes_multiplier: String(minutes),
        },
    });
    const raw = json?.data?.chartbit;
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw
        .map((c: Record<string, unknown>): Candle => ({
            date: Number(c.unix_timestamp),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume),
        }))
        .reverse();
};

export const fetchCandles = async ({ symbol, range = "30d", interval = "1d" }: {
    symbol: string;
    range?: string;
    interval?: string;
}): Promise<Candle[]> => {
    // Index symbols aren't on chartbit per stock, so go straight to Yahoo.
    if (!symbol.startsWith("^")) {
        try {
            const days = rangeToDays(range);
            const m = interval.match(/^(\d+)m$/);
            const candles = m
                ? await fetchStockbitIntraday(symbol, days, parseInt(m[1], 10))
                : await fetchStockbitDaily(symbol, days);
            if (candles.length > 0) return candles;
        } catch {
            // fall through to Yahoo
        }
    }
    return fetchYahooCandles({ symbol, range, interval });
};

// Drop in for yahooCandles.fetchYahooDaily: YahooCandle[] (string dates, oldest first).
export const fetchDaily = async ({ symbol, days = 60 }: {
    symbol: string;
    days?: number;
}): Promise<YahooCandle[]> => {
    if (!symbol.startsWith("^")) {
        try {
            const raw = await rawDaily(symbol, days);
            if (raw.length > 0) {
                return raw
                    .map((c): YahooCandle => ({
                        date: String(c.date), // chartbit gives "YYYY-MM-DD" directly
                        open: Number(c.open),
                        high: Number(c.high),
                        low: Number(c.low),
                        close: Number(c.close),
                        volume: Number(c.volume),
                    }))
                    .reverse();
            }
        } catch {
            // fall through to Yahoo
        }
    }
    return fetchYahooDaily({ symbol, days });
};

// Drop in for yahooCandles.fetchYahooDailyMulti: per symbol Stockbit first with Yahoo fallback.
export const fetchDailyMulti = async ({ symbols, days = 60 }: {
    symbols: string[];
    days?: number;
}): Promise<Record<string, YahooCandle[]>> => {
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            try {
                return [symbol, await fetchDaily({ symbol, days })] as const;
            } catch {
                return [symbol, [] as YahooCandle[]] as const;
            }
        }),
    );
    return Object.fromEntries(entries);
};
