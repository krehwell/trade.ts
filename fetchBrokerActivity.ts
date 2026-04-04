import { TOKEN } from "./constants.ts";

const BASE = "https://exodus.stockbit.com";

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

const request = async ({
    path,
    params,
}: { path: string; params: Record<string, string | string[]> }) => {
    const u = new URL(path, BASE);
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v))
            v.forEach((item) => u.searchParams.append(k, item));
        else u.searchParams.set(k, v);
    }
    const res = await fetch(u.toString(), {
        headers: { Authorization: TOKEN },
    });
    return res.json();
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchBrokerActivitySingle = async ({
    broker,
    from,
    to,
}: { broker: string; from: string; to: string }): Promise<StockFlow> => {
    const res = await request({
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
    if (!bat) return {};

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

    for (const broker of brokers) {
        await delay(300);
        const single = await fetchBrokerActivitySingle({ broker, from, to });
        for (const [sym, val] of Object.entries(single)) {
            result[sym] = (result[sym] ?? 0) + val;
        }
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
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const sub = (d: Date, n: number) => {
        const r = new Date(d);
        r.setDate(r.getDate() - n);
        return r;
    };

    const to = fmt(ref);
    const result: Record<string, StockFlow> = {};

    for (const tf of timeframes) {
        const days = parseTFDays(tf);
        const from = fmt(sub(ref, days));
        result[tf] = await fetchBrokerActivity({ brokers, from, to });
    }

    return result;
};

const parseTFDays = (tf: string): number => {
    const match = tf.match(/^(\d+)([dwm])$/i);
    if (!match) throw new Error(`Invalid timeframe: ${tf}`);
    const [, n, unit] = match;
    if (unit === "d") return Number(n);
    if (unit === "w") return Number(n) * 7;
    if (unit === "m") return Number(n) * 30;
    throw new Error(`Invalid timeframe unit: ${unit}`);
};

export const fetchTopBrokers = async (): Promise<Broker[]> => {
    const res = await request({
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
