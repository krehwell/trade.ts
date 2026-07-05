// Stock metadata from Growin REST (corporate action, UMA, suspension).
// Cookie cached per run: Growin is single-session, one login covers all symbols.
import { getGrowinCookie } from "../net/growinAuth.ts";

export interface StockMeta {
    symbol: string;
    corporateAction: string;
    corporateActionString: string;
    isUma: boolean;
    isSuspended: boolean;
}

// Canonical warning strings so every tool flags the same conditions the same
// way. Ex-date actions start with "X"; "--" means no action.
export const metaWarnings = (m: StockMeta): string[] => {
    const w: string[] = [];
    if (m.isSuspended) w.push("SUSPENDED");
    if (m.isUma) w.push("UMA");
    if (m.corporateAction.startsWith("X")) w.push(`ex-date ${m.corporateActionString}`);
    else if (m.corporateAction !== "--" && m.corporateAction !== "") w.push(`corporate action ${m.corporateActionString}`);
    return w;
};

let cookie: string | null = null;

export const fetchStockMeta = async ({ symbol }: { symbol: string }): Promise<StockMeta> => {
    cookie ??= await getGrowinCookie();
    const res = await fetch(
        `https://api.growin.id/marketdata/api/v1/orderbook/${symbol.toUpperCase()}`,
        {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0",
                Accept: "application/json, text/plain, */*",
                "Accept-Language": "en",
                Origin: "https://invest.growin.id",
                Referer: "https://invest.growin.id/",
                "x-app-name": "web",
                "x-app-version": "v1.0.0",
                Cookie: cookie,
            },
        },
    );
    if (!res.ok) throw new Error(`Growin meta ${symbol}: HTTP ${res.status}`);
    const d = (await res.json())?.data;
    if (!d) throw new Error(`Growin meta ${symbol}: empty payload`);
    return {
        symbol: symbol.toUpperCase(),
        corporateAction: d.corporate_action ?? "",
        corporateActionString: d.corporate_action_string ?? "",
        isUma: !!d.is_uma,
        isSuspended: !!d.is_suspended,
    };
};
