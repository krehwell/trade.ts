// Broker activity from Stockbit: net buy/sell value per stock for a set of brokers
// over a date range.  Summing a smart money broker set vs a retail set is how the
// picker measures institutional vs retail flow.  Max 200 buy + 200 sell rows per call.
import { fmt, parseTFDays, subDays } from "../util/date.ts";
import { fetchGET } from "../net/stockbitFetch.ts";

export type BrokerGroup =
    | "BROKER_GROUP_FOREIGN"
    | "BROKER_GROUP_LOCAL"
    | "BROKER_GROUP_GOVERNMENT";
export interface Broker {
    code: string;
    name: string;
    group: BrokerGroup;
}
export type StockFlow = Record<string, number>;

// Smart money broker set (foreign/institutional desks). Validate against
// /order-trade/broker/top before adding codes — invalid codes fail silently as {}.
// MS (Morgan Stanley) + CG (Citigroup) removed Jul 2026: deregistered from IDX.
export const SM_BROKERS = ["BK", "CS", "GW", "KZ", "RX", "DP", "AK", "ZP", "LG", "TP", "KI", "HP"];

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchBrokerActivitySingle = async ({
    broker,
    from,
    to,
}: { broker: string; from: string; to: string }): Promise<StockFlow> => {
    const res = await fetchGET({
        path: "/order-trade/broker/activity",
        params: {
            broker_code: broker,
            limit: "200",
            page: "1",
            from,
            to,
            transaction_type: "TRANSACTION_TYPE_NET",
            market_board: "MARKET_TYPE_REGULER",
            investor_type: "INVESTOR_TYPE_ALL",
        },
    });

    const bat = res.data?.broker_activity_transaction;
    if (!bat) {
        // Invalid broker code or rate-limited response — surface it, silent {} undercounts flow
        console.error(`  warn broker ${broker} ${from}..${to}: ${res.message ?? "empty response"}`);
        return {};
    }

    const result: StockFlow = {};
    for (const item of bat.brokers_buy ?? []) {
        result[item.stock_code] = (result[item.stock_code] ?? 0) + item.value;
    }
    for (const item of bat.brokers_sell ?? []) {
        result[item.stock_code] = (result[item.stock_code] ?? 0) + item.value;
    }
    return result;
};

export const fetchBrokerActivity = async ({
    brokers,
    from,
    to,
}: { brokers: string[]; from: string; to: string }): Promise<StockFlow> => {
    const result: StockFlow = {};

    // Sequential + delay: >~40 parallel requests trips the rate limiter, which
    // returns empty payloads that silently sum as zero flow.
    for (const broker of brokers) {
        const single = await fetchBrokerActivitySingle({ broker, from, to });
        for (const [sym, val] of Object.entries(single)) {
            result[sym] = (result[sym] ?? 0) + val;
        }
        await delay(150);
    }

    return result;
};

export const fetchBrokerActivityMultiTF = async ({
    brokers,
    date,
    timeframes,
}: { brokers: string[]; date: string; timeframes: string[] }): Promise<
    Record<string, StockFlow>
> => {
    const ref = new Date(date);
    const to = fmt(ref);
    const result: Record<string, StockFlow> = {};

    for (const tf of timeframes) {
        const days = parseTFDays(tf);
        const from = fmt(subDays(ref, days));
        result[tf] = await fetchBrokerActivity({ brokers, from, to });
    }

    return result;
};

export const fetchTopBrokers = async (): Promise<Broker[]> => {
    const res = await fetchGET<{ data: { list: Broker[] } }>({
        path: "/order-trade/broker/top",
        params: {
            sort: "TB_SORT_BY_TOTAL_VALUE",
            order: "ORDER_BY_DESC",
            period: "TB_PERIOD_LAST_1_DAY",
            market_type: "MARKET_TYPE_ALL",
            eod_only: "true",
        },
    });
    return res.data.list;
};
