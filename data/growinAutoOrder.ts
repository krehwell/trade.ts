// Growin auto-order (conditional order) API. Endpoints captured from the web app.
// This is the ONLY REST order path Growin exposes. Plain "direct" orders go over
// a WebSocket that HAR can't capture. Auto-order covers buy/sell/cancel + auto
// sell-after-buy, so it's the practical scripting surface.
import { growinFetch } from "../net/growinFetch.ts";
import { today } from "../util/date.ts";

// Reguler board id (not cash board). Create/amend need it, not the symbol.
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

// Condition = when the order enters the book (UI "When the price is").
// Execute = at what price once triggered (UI "Execute": Price or Tick).
export interface Condition {
    op: "le" | "ge"; // price <= or >= value
    price: number;
}
export interface Execute {
    mode: "price" | "tick"; // limit at value, or tick offset from the trigger (-20..20)
    value: number;
}

export interface CreateAutoOrder {
    symbol: string;
    side: "BUY" | "SELL";
    lot: number;
    condition: Condition;
    execute: Execute;
    validUntil?: string; // default today
    sellAfterBuyPrice?: number; // BUY only: auto-place a sell at this price after fill
}

// Maps the UI's condition + execute onto the captured payload fields.
//   Condition: BUY triggers on last price (last_price_*_bound), SELL on target
//     price (target_price_*_bound). That asymmetry is what the captured frames show.
//   Execute: Price => order_set_type 2 + quote_price. Tick => order_set_type 1 + tick_size.
// Some mappings (ge condition, the target mirror for buy) are inferred from a
// single capture, so createAutoOrder returns the payload to eyeball, and each new
// variant should be verified against the app on first use.
export const buildCreatePayload = (o: CreateAutoOrder) => {
    const buy = o.side === "BUY";
    const sellAfter = buy && o.sellAfterBuyPrice != null;
    const c = o.condition;
    const priceMode = o.execute.mode === "price";
    return {
        side: buy ? 1 : 2,
        lot: o.lot,
        // Field names are inverted vs intuition: *_upper_bound => "Price >= X",
        // *_lower_bound => "Price <= X" (verified from the order's "strategies" text).
        last_price_upper_bound: buy && c.op === "ge" ? c.price : null,
        last_price_lower_bound: buy && c.op === "le" ? c.price : null,
        drop_price_type: 0,
        drop_percentage: null,
        drop_price_from: null,
        order_set_type: priceMode ? 2 : 1,
        tick_size: priceMode ? null : o.execute.value,
        start_from: today(),
        valid_until: o.validUntil ?? today(),
        stock_code: o.symbol.toUpperCase(),
        orderbook_id: 0, // filled by createAutoOrder
        price: null,
        total_profit: null,
        total_loss: null,
        ratio_profit: null,
        ratio_loss: null,
        quote_price: priceMode ? o.execute.value : null,
        target_price_upper_bound: !buy && c.op === "ge" ? c.price : null,
        target_price_lower_bound: !buy && c.op === "le" ? c.price : null,
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

// A new order is created PAUSED and does nothing until it is played.
export const CONTROL = { PAUSE: 1, PLAY: 2 } as const;
type ControlState = typeof CONTROL[keyof typeof CONTROL];

export const controlAutoOrder = (uuid: string, state: ControlState) =>
    growinFetch("/autoorder/api/v1/control", {
        method: "PUT",
        body: { auto_order_uuid: uuid, control_state: state },
    });

export const createAutoOrder = async (o: CreateAutoOrder): Promise<{ uuid: string; payload: unknown }> => {
    const payload = buildCreatePayload(o);
    payload.orderbook_id = await resolveOrderbookId(o.symbol);
    const j = await growinFetch("/autoorder/api/v1", { method: "POST", body: payload });
    const uuid = j?.data?.auto_order_uuid;
    if (uuid) await controlAutoOrder(uuid, CONTROL.PLAY); // created paused, play so it runs
    return { uuid, payload };
};

// hard delete (permanent cancel)
export const deleteAutoOrder = (uuid: string) =>
    growinFetch(`/autoorder/api/v1/${uuid}`, { method: "DELETE" });
