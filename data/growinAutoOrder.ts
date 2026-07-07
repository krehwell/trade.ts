// Growin auto-order (conditional order) API. Endpoints captured from the web app.
// This is the ONLY REST order path Growin exposes; plain "direct" orders go over
// a WebSocket that HAR can't capture. Auto-order covers buy/sell/cancel + auto
// sell-after-buy, so it's the practical scripting surface.
import { growinFetch } from "../net/growinFetch.ts";
import { today } from "../util/date.ts";

// Reguler board id (not cash board); create/amend need it, not the symbol.
export const resolveOrderbookId = async (symbol: string): Promise<number> => {
    const d = (await growinFetch(`/marketdata/api/v1/orderbook/${symbol.toUpperCase()}`))?.data;
    const id = d?.id_orderbook_reguler;
    if (!id) throw new Error(`No orderbook id for ${symbol}`);
    return id;
};

export interface AutoOrder {
    uuid: string;
    symbol: string;
    side: "BUY" | "SELL";
    lot: number;
    status: number; // 1 active/waiting, 2 stopped, 3 running, 5 done/expired
    quotePrice: number | null;
    targetUpper: number | null;
    validFrom: string;
    validUntil: string;
    buyRef: string | null; // set on the sell leg of a sell-after-buy pair
}

const STATUS: Record<number, string> = {
    1: "active", 2: "stopped", 3: "running", 5: "done/expired",
};
export const statusLabel = (s: number): string => STATUS[s] ?? `status ${s}`;

export const listAutoOrders = async (): Promise<AutoOrder[]> => {
    const d = (await growinFetch("/autoorder/api/v1"))?.data ?? [];
    return d.map((a: Record<string, unknown>) => ({
        uuid: a.auto_order_uuid as string,
        symbol: a.stock_code as string,
        side: a.side === 1 ? "BUY" : "SELL",
        lot: a.lot as number,
        status: a.auto_order_status as number,
        quotePrice: (a.quote_price as number) ?? null,
        targetUpper: (a.target_price_upper_bound as number) ?? null,
        validFrom: a.start_from as string,
        validUntil: a.valid_until as string,
        buyRef: (a.strategy_buy_reference_uuid as string) ?? null,
    }));
};

export interface CreateAutoOrder {
    symbol: string;
    side: "BUY" | "SELL";
    lot: number;
    price: number; // limit price (quote_price, order_set_type 2)
    validUntil?: string; // default today
    // optional: after a BUY fills, auto-place a SELL at this price
    sellAfterBuyPrice?: number;
}

// Builds the exact payload shape captured from the web app (order_set_type 2 =
// absolute quote_price limit). target_price_upper_bound mirrors quote_price:
// that's the activation level the UI sends for an immediate limit order.
export const buildCreatePayload = (o: CreateAutoOrder) => {
    const buy = o.side === "BUY";
    const sellAfter = buy && o.sellAfterBuyPrice != null;
    // Auto-order = condition (when price hits X, order enters book) + execute.
    //   BUY : condition "last <= price" (last_price_upper_bound), execute Price
    //         limit at price (order_set_type 2). API requires a buy condition.
    //   SELL: condition "price >= price" (target_price_upper_bound), execute Tick
    //         0 (order_set_type 1) = place at the trigger price. Matches the
    //         known-good captured sell; tick fills more reliably than a limit.
    return {
        side: buy ? 1 : 2,
        lot: o.lot,
        last_price_upper_bound: buy ? o.price : null,
        last_price_lower_bound: null,
        drop_price_type: 0,
        drop_percentage: null,
        drop_price_from: null,
        order_set_type: buy ? 2 : 1,
        tick_size: buy ? null : 0,
        start_from: today(),
        valid_until: o.validUntil ?? today(),
        stock_code: o.symbol.toUpperCase(),
        orderbook_id: 0, // filled by createAutoOrder
        price: null,
        total_profit: null,
        total_loss: null,
        ratio_profit: null,
        ratio_loss: null,
        quote_price: buy ? o.price : null,
        target_price_upper_bound: o.price,
        target_price_lower_bound: null,
        enable_trailing_stop: false,
        sell_if_drop_percentage: null,
        after_gaining_percentage: null,
        trailing_stop_type: 0,
        enable_sell_after_buy: sellAfter,
        sell_after_buy_order_set: sellAfter ? 2 : 0,
        sell_after_buy_tick_size: null,
        sell_after_buy_quote_price: sellAfter ? o.sellAfterBuyPrice : null,
        auto_order_uuid: "",
    };
};

export const createAutoOrder = async (o: CreateAutoOrder): Promise<{ uuid: string; payload: unknown }> => {
    const payload = buildCreatePayload(o);
    payload.orderbook_id = await resolveOrderbookId(o.symbol);
    const j = await growinFetch("/autoorder/api/v1", { method: "POST", body: payload });
    return { uuid: j?.data?.auto_order_uuid, payload };
};

// control_state 2 = pause (resumable), 1 = resume
export const controlAutoOrder = (uuid: string, state: 1 | 2) =>
    growinFetch("/autoorder/api/v1/control", {
        method: "PUT",
        body: { auto_order_uuid: uuid, control_state: state },
    });

// hard delete (permanent cancel)
export const deleteAutoOrder = (uuid: string) =>
    growinFetch(`/autoorder/api/v1/${uuid}`, { method: "DELETE" });
