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
    state: string; // paused | running | done, from control_state (not auto_order_status)
    condition: string; // human-readable trigger from the API, e.g. "If Price >= 63"
    validFrom: string;
    validUntil: string;
    buyRef: string | null; // set on the sell leg of a sell-after-buy pair
}

// control_state, not auto_order_status: the latter says "active" even for a
// paused order, which is exactly the confusion that hid the pause/play bug.
const STATE: Record<number, string> = { 1: "paused", 2: "running", 3: "done", 4: "fired" };

export const listAutoOrders = async (): Promise<AutoOrder[]> => {
    const d = (await growinFetch("/autoorder/api/v1"))?.data ?? [];
    return d.map((a: Record<string, unknown>) => ({
        uuid: a.auto_order_uuid as string,
        symbol: a.stock_code as string,
        side: a.side === 1 ? "BUY" : "SELL",
        lot: a.lot as number,
        state: STATE[a.control_state as number] ?? `control ${a.control_state}`,
        condition: (a.strategies as string) ?? "",
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
    condition?: Condition; // price trigger, optional when tp/sl given
    tpPct?: number; // SELL: ratio_profit, fire when profit >= tpPct% of avg price
    slPct?: number; // SELL: ratio_loss, fire when loss >= slPct% of avg price
    execute: Execute;
    validUntil?: string; // default today
    sellAfterBuyPrice?: number; // BUY only: auto-place a sell at this price after fill
}

// Maps the UI's condition + execute onto the payload fields (verified live).
//   Condition: BUY triggers on last price (last_price_*_bound), SELL on target
//     price (target_price_*_bound). Field names are inverted: *_upper_bound means
//     "Price >= X" and *_lower_bound means "Price <= X".
//   Execute: Price => order_set_type 2 + quote_price. Tick => order_set_type 1 + tick_size.
export const buildCreatePayload = (o: CreateAutoOrder) => {
    const buy = o.side === "BUY";
    const sellAfter = buy && o.sellAfterBuyPrice != null;
    const c = o.condition;
    const priceMode = o.execute.mode === "price";
    return {
        side: buy ? 1 : 2,
        lot: o.lot,
        last_price_upper_bound: buy && c?.op === "ge" ? c.price : null,
        last_price_lower_bound: buy && c?.op === "le" ? c.price : null,
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
        // Ratio %: raw percent of avg price (7 = 7%), verified from a capture.
        ratio_profit: o.tpPct ?? null,
        ratio_loss: o.slPct ?? null,
        quote_price: priceMode ? o.execute.value : null,
        target_price_upper_bound: !buy && c?.op === "ge" ? c.price : null,
        target_price_lower_bound: !buy && c?.op === "le" ? c.price : null,
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
