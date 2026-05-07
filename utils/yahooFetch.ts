export interface YahooCandle {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface Candle {
    date: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export const fetchCandles = async ({ symbol, range = "30d", interval = "1d" }: {
    symbol: string;
    range?: string;
    interval?: string;
}): Promise<Candle[]> => {
    const ticker = symbol.startsWith("^") || symbol.endsWith(".JK") ? symbol : `${symbol}.JK`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=${range}&interval=${interval}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const json = await res.json();

    const result = json.chart?.result?.[0];
    if (!result?.timestamp) return [];

    const ts = result.timestamp as number[];
    const q = result.indicators.quote[0];
    const candles: Candle[] = [];

    for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        candles.push({
            date: ts[i],
            open: q.open[i],
            high: q.high[i],
            low: q.low[i],
            close: q.close[i],
            volume: q.volume[i],
        });
    }

    return candles;
};

export const fetchYahooDaily = async ({ symbol, days = 60 }: {
    symbol: string;
    days?: number;
}): Promise<YahooCandle[]> => {
    const period2 = Math.floor(Date.now() / 1000) + 86400;
    const period1 = period2 - days * 86400;
    const ticker = symbol.startsWith("^") || symbol.endsWith(".JK") ? symbol : `${symbol}.JK`;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const json = await res.json();

    const result = json.chart?.result?.[0];
    if (!result?.timestamp) return [];

    const ts = result.timestamp as number[];
    const q = result.indicators.quote[0];
    const candles: YahooCandle[] = [];

    for (let i = 0; i < ts.length; i++) {
        if (q.close[i] == null) continue;
        candles.push({
            date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
            open: q.open[i],
            high: q.high[i],
            low: q.low[i],
            close: q.close[i],
            volume: q.volume[i],
        });
    }

    return candles; // chronological (oldest first)
};

export const fetchYahooDailyMulti = async ({ symbols, days = 60 }: {
    symbols: string[];
    days?: number;
}): Promise<Record<string, YahooCandle[]>> => {
    const entries = await Promise.all(
        symbols.map(async (sym) => {
            try {
                return [sym, await fetchYahooDaily({ symbol: sym, days })] as const;
            } catch {
                return [sym, []] as const;
            }
        })
    );
    return Object.fromEntries(entries);
};
