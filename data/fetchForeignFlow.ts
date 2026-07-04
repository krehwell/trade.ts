// Foreign flow per stock from idx.co.id daily stock summary. Token-free, needs
// browser headers or Cloudflare blocks it. ForeignBuy/Sell are shares; net value
// approximated with close price. EOD data: today is empty until after close.
import { warpClient } from "../net/warpClient.ts";
import { fmt, subDays } from "../util/date.ts";

export interface ForeignFlow {
    symbol: string;
    close: number;
    chgPct: number;
    foreignBuy: number;
    foreignSell: number;
    foreignNetShares: number;
    foreignNetValue: number;
}

interface IdxRow {
    StockCode: string;
    Close: number;
    Previous: number;
    ForeignBuy: number;
    ForeignSell: number;
}

export const fetchForeignFlow = async ({ date }: { date: string }): Promise<ForeignFlow[]> => {
    const d = date.replaceAll("-", "");
    const res = await fetch(
        `https://www.idx.co.id/primary/TradingSummary/GetStockSummary?length=9999&start=0&date=${d}`,
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0",
                Accept: "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.5",
                Referer: "https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham",
                "X-Requested-With": "XMLHttpRequest",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            },
            client: warpClient,
        },
    );
    if (!res.ok) throw new Error(`IDX GetStockSummary ${res.status}`);
    const json = await res.json();
    const rows: IdxRow[] = json?.data ?? [];
    return rows
        .map((r) => {
            const net = (r.ForeignBuy || 0) - (r.ForeignSell || 0);
            return {
                symbol: r.StockCode,
                close: r.Close,
                chgPct: r.Previous > 0 ? ((r.Close - r.Previous) / r.Previous) * 100 : 0,
                foreignBuy: r.ForeignBuy || 0,
                foreignSell: r.ForeignSell || 0,
                foreignNetShares: net,
                foreignNetValue: net * r.Close,
            };
        })
        .filter((r) => r.foreignBuy > 0 || r.foreignSell > 0);
};

// Walk back from today until a trading day with data (weekends, holidays, pre-EOD).
export const fetchLatestForeignFlow = async ({ maxBack = 5 }: { maxBack?: number } = {}): Promise<
    { date: string; flows: ForeignFlow[] }
> => {
    for (let i = 0; i <= maxBack; i++) {
        const date = fmt(subDays(new Date(), i));
        const flows = await fetchForeignFlow({ date });
        if (flows.length > 0) return { date, flows };
    }
    return { date: "", flows: [] };
};
