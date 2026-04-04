import { TOKEN } from "./constants.ts";

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
    perPage = 25,
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

    const payload = JSON.stringify({
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
    });

    const res = await fetch("https://exodus.stockbit.com/screener/templates", {
        method: "POST",
        headers: { Authorization: TOKEN, "Content-Type": "application/json" },
        body: payload,
    });

    const json = await res.json();
    const d = json.data;

    const stocks: ScreenerStock[] = (d.calcs ?? []).map((c: any) => {
        const results: Record<string, number> = {};
        for (const r of c.results) results[r.item] = Number(r.raw);
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
