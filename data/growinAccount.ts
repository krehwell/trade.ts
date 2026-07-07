// Growin account reads: portfolio, cash, orders, realized P&L.
// Endpoints captured from the invest.growin.id web session; auth via growinFetch.
import { growinFetch } from "../net/growinFetch.ts";
import { daysAgo, today } from "../util/date.ts";

const get = (path: string) => growinFetch(path);

export interface Holding {
    symbol: string;
    avgPrice: number;
    lastPrice: number;
    lotAvailable: number;
    lotOnDeliver: number; // bought today, not yet settled (T+0)
    pnlPct: number;
    corporateAction: string; // "XD" = ex-dividend, "--"/"" = none
    isSuspended: boolean;
    isUma: boolean;
}

export const fetchHoldings = async (): Promise<Holding[]> => {
    const d = (await get("/user/api/protected/v2/portfolio/stock"))?.data ?? [];
    return d.map((s: Record<string, unknown>) => ({
        symbol: s.Stock as string,
        avgPrice: s.AvgPrice as number,
        lastPrice: s.LastPrice as number,
        lotAvailable: s.LotAvailablePrecise as number,
        lotOnDeliver: s.LotOnDeliverPrecise as number,
        pnlPct: s.PotentialGlPct as number,
        corporateAction: (s.CorporateAction as string) ?? "",
        isSuspended: !!s.IsSuspended,
        isUma: !!s.IsUMA,
    }));
};

export interface Consolidated {
    totalAsset: number;
    availableCash: number;
    tradeLimit: number;
    penaltyCharges: number;
}

export const fetchConsolidated = async (): Promise<Consolidated> => {
    const d = (await get("/user/api/protected/v1/portfolio/consolidated"))?.data;
    return {
        totalAsset: d.total_asset_value,
        availableCash: d.available_cash,
        tradeLimit: d.trade_limit,
        penaltyCharges: d.penalty_charges,
    };
};

export interface CashSettlement {
    dates: { t0: string; t1: string; t2: string };
    netCash: { t0: number; t1: number; t2: number };
    receivable: { t0: number; t1: number; t2: number };
    payable: { t0: number; t1: number; t2: number };
}

export const fetchCash = async (): Promise<CashSettlement> => {
    const d = (await get("/user/api/protected/v2/portfolio-stock/cash"))?.data;
    return {
        dates: { t0: d.t0_date, t1: d.t1_date, t2: d.t2_date },
        netCash: d.net_cash,
        receivable: d.receivable,
        payable: d.payable,
    };
};

export interface Order {
    id: number;
    date: number; // YYYYMMDD
    entryTime: string;
    symbol: string;
    side: "BUY" | "SELL";
    price: number;
    lot: number;
    matchedLot: number;
    remainingLot: number;
    status: string; // OPEN, PARTIAL, PENDING, MATCHED, CANCELED, AMENDED, REJECTED
    grossAmount: number;
    canAmend: boolean;
    canWithdraw: boolean;
}

const LIVE = new Set(["OPEN", "PARTIAL", "PENDING"]);
export const isLive = (o: Order): boolean => LIVE.has(o.status);

// Orders can be amended/withdrawn only in certain states. Map is per
// order_type+status (DIRECTOPEN, POOLINGPARTIAL, ...); we key on the tail.
let actionMap: Record<string, { AMEND: boolean; WITHDRAW: boolean }> | null = null;
const loadActionMap = async () => {
    if (actionMap) return actionMap;
    actionMap = (await get("/order/api/v1/order-status-action-map"))?.data ?? {};
    return actionMap!;
};

export const fetchOrders = async (
    { start = daysAgo(30), end = today() }: { start?: string; end?: string } = {},
): Promise<Order[]> => {
    const map = await loadActionMap();
    const out: Order[] = [];
    for (let page = 1; page < 20; page++) {
        const j = await get(
            `/order/api/v1/protected/order-list?page=${page}&start_date=${start}&end_date=${end}`,
        );
        for (const o of j.data ?? []) {
            const key = `${o.order_type}${o.order_status}`; // e.g. DIRECTOPEN
            const act = map[key] ?? { AMEND: false, WITHDRAW: false };
            out.push({
                id: o.transaction_id,
                date: o.order_date,
                entryTime: o.entry_time,
                symbol: o.symbol,
                side: o.side === "1" ? "BUY" : "SELL",
                price: o.price,
                lot: o.quantity,
                matchedLot: o.match_quantity,
                remainingLot: o.remaining_quantity,
                status: o.order_status,
                grossAmount: o.gross_amount,
                canAmend: act.AMEND,
                canWithdraw: act.WITHDRAW,
            });
        }
        if (j.current_page >= j.total_page) break;
    }
    return out;
};

export interface RealizedTrade {
    date: string;
    symbol: string;
    lot: number;
    buyPrice: number;
    sellPrice: number;
    glPct: number;
    grossGl: number;
    nettGl: number;
}

export interface RealizedPnl {
    totalGrossGl: number;
    totalNettGl: number;
    trades: RealizedTrade[];
}

export const fetchRealizedPnl = async (
    { start = daysAgo(30), end = today() }: { start?: string; end?: string } = {},
): Promise<RealizedPnl> => {
    const j = await get(
        `/user/api/protected/v2/portfolio/gain-loss?startDate=${start}&endDate=${end}&page=1&limit=100`,
    );
    const d = j?.data;
    return {
        totalGrossGl: d.total_gross_gl,
        totalNettGl: d.total_nett_gl,
        trades: (d.portfolio_gl ?? []).map((t: Record<string, unknown>) => ({
            date: t.transaction_date as string,
            symbol: t.stock_code as string,
            lot: t.number_of_lot as number,
            buyPrice: t.buy_price as number,
            sellPrice: t.sell_price as number,
            glPct: t.gl_in_percent as number,
            grossGl: t.gross_gl as number,
            nettGl: t.nett_gl as number,
        })),
    };
};
