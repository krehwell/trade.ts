// Stockbit screener API.  Quirks worth knowing:
//   results only include the columns listed in `sequence` (not every filter),
//   the `name` field must be non empty, and there is no date param (always current data).
import { fetchPOST } from "../net/stockbitFetch.ts";
import { ITEMS } from "./screenerItems.ts";

export interface ScreenerFilter {
    id: number;
    operator: ">" | "<" | ">=" | "<=" | "=" | "!=";
    value: number | string;
}

export interface ScreenerStock {
    symbol: string;
    name: string;
    results: Record<string, number>;
}

export interface ScreenerResult {
    stocks: ScreenerStock[];
    totalRows: number;
    page: number;
    perPage: number;
}

export const fetchScreener = async ({
    filters = [],
    page = 1,
    universe = "IHSG",
    orderCol,
    orderType = "asc",
}: {
    filters?: ScreenerFilter[];
    page?: number;
    perPage?: number;
    universe?: string;
    orderCol?: number;
    orderType?: "asc" | "desc";
} = {}): Promise<ScreenerResult> => {
    const filterPayload = filters.map((f) => ({
        type: "basic",
        item1: f.id,
        item1name: "",
        operator: f.operator,
        item2: String(f.value),
        multiplier: "",
    }));

    const json = await fetchPOST({
        path: "/screener/templates",
        body: {
            name: "screen",
            description: "",
            save: "0",
            ordertype: orderType,
            ordercol: orderCol ?? filters[0]?.id ?? 2661,
            page,
            universe: JSON.stringify({ scope: universe, scopeID: "", name: "" }),
            filters: JSON.stringify(filterPayload),
            sequence: String(filters.map((f) => f.id).join(",")),
            screenerid: "0",
            type: "TEMPLATE_TYPE_CUSTOM",
        },
    });

    const d = json.data;

    // deno-lint-ignore no-explicit-any
    const stocks: ScreenerStock[] = (d.calcs ?? []).map((c: any) => {
        const results: Record<string, number> = {};
        for (const r of c.results) results[r.id] = Number(r.raw);
        return { symbol: c.company.symbol, name: c.company.name, results };
    });

    return {
        stocks,
        totalRows: d.totalrows,
        page: d.curpage,
        perPage: d.perpage,
    };
};

export const fetchScreenerAll = async ({
    filters = [],
    universe = "IHSG",
    orderCol,
    orderType = "asc",
}: {
    filters?: ScreenerFilter[];
    universe?: string;
    orderCol?: number;
    orderType?: "asc" | "desc";
} = {}): Promise<ScreenerStock[]> => {
    const all: ScreenerStock[] = [];
    let page = 1;

    while (true) {
        const res = await fetchScreener({
            filters,
            page,
            universe,
            orderCol,
            orderType,
        });
        all.push(...res.stocks);
        if (all.length >= res.totalRows) break;
        page++;
    }

    return all;
};

export interface BandarDelta {
    symbol: string;
    bandar: number;     // cumulative BANDAR_VALUE
    bandarPrev: number;
    delta: number;      // today's flow = bandar - bandarPrev
}

// Every positive-cum bandar stock with today's delta, biggest inflow first.
// The one "top inflows" list all tools share (daily scan, trap check).
// API ignores ordercol, so fetch all pages and rank locally.
export const fetchBandarDeltas = async (): Promise<BandarDelta[]> => {
    const stocks = await fetchScreenerAll({
        filters: [
            { id: ITEMS.BANDAR_VALUE, operator: ">", value: 0 },
            { id: ITEMS.BANDAR_PREV_VALUE, operator: "!=", value: 999999999999 },
        ],
    });
    return stocks
        .map((s) => {
            const bandar = s.results[ITEMS.BANDAR_VALUE] || 0;
            const bandarPrev = s.results[ITEMS.BANDAR_PREV_VALUE] || 0;
            return { symbol: s.symbol, bandar, bandarPrev, delta: bandar - bandarPrev };
        })
        .sort((a, b) => b.delta - a.delta);
};
