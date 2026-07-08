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
    dropPct?: number; // BUY: drop_percentage, fire when price drops dropPct% from its high
    tpPct?: number; // SELL: ratio_profit, fire when profit >= tpPct% of avg price
    slPct?: number; // SELL: ratio_loss, fire when loss >= slPct% of avg price
    tpRp?: number; // SELL: total_profit, fire when profit >= tpRp rupiah
    slRp?: number; // SELL: total_loss, fire when loss >= slRp rupiah
    trailGain?: number; // SELL: after_gaining_percentage, trailing arms after +gain%
    trailDrop?: number; // SELL: sell_if_drop_percentage, then sell if it drops drop%
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
        // Drop by %: buy when price falls dropPct% from its high. type 1 = From Highest Price.
        drop_price_type: o.dropPct != null ? 1 : 0,
        drop_percentage: o.dropPct ?? null,
        drop_price_from: null,
        order_set_type: priceMode ? 2 : 1,
        tick_size: priceMode ? null : o.execute.value,
        start_from: today(),
        valid_until: o.validUntil ?? today(),
        stock_code: o.symbol.toUpperCase(),
        orderbook_id: 0, // filled by createAutoOrder
        price: null,
        total_profit: o.tpRp ?? null, // absolute rupiah profit trigger
        total_loss: o.slRp ?? null, // absolute rupiah loss trigger
        // Ratio %: raw percent of avg price (7 = 7%), verified from a capture.
        ratio_profit: o.tpPct ?? null,
        ratio_loss: o.slPct ?? null,
        quote_price: priceMode ? o.execute.value : null,
        target_price_upper_bound: !buy && c?.op === "ge" ? c.price : null,
        target_price_lower_bound: !buy && c?.op === "le" ? c.price : null,
        // Trailing stop: arm after +trailGain%, then sell if it drops trailDrop%.
        // trailing_stop_type 1 = Last Price (the reference the drop is measured from).
        enable_trailing_stop: o.trailGain != null && o.trailDrop != null,
        sell_if_drop_percentage: o.trailDrop ?? null,
        after_gaining_percentage: o.trailGain ?? null,
        trailing_stop_type: o.trailGain != null ? 1 : 0,
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

// Reconstruct a CreateAutoOrder from a GET row, so an edit can rebuild the full
// payload with only some fields changed. Unset ratio/total/drop fields come back
// as 0 or null, both mean "not set", hence the `|| undefined`.
// deno-lint-ignore no-explicit-any
const rowToOrder = (r: any): CreateAutoOrder => {
    const buy = r.side === 1;
    const ge = buy ? r.last_price_upper_bound : r.target_price_upper_bound;
    const le = buy ? r.last_price_lower_bound : r.target_price_lower_bound;
    return {
        symbol: r.stock_code,
        side: buy ? "BUY" : "SELL",
        lot: r.lot,
        condition: ge ? { op: "ge", price: ge } : le ? { op: "le", price: le } : undefined,
        dropPct: r.drop_price_type === 1 ? r.drop_percentage : undefined,
        tpPct: r.ratio_profit || undefined,
        slPct: r.ratio_loss || undefined,
        tpRp: r.total_profit || undefined,
        slRp: r.total_loss || undefined,
        trailGain: r.enable_trailing_stop ? r.after_gaining_percentage : undefined,
        trailDrop: r.enable_trailing_stop ? r.sell_if_drop_percentage : undefined,
        execute: r.order_set_type === 2 ? { mode: "price", value: r.quote_price } : { mode: "tick", value: r.tick_size },
        validUntil: r.valid_until,
        sellAfterBuyPrice: r.enable_sell_after_buy ? r.sell_after_buy_quote_price : undefined,
    };
};

// Edit an auto-order in place (same uuid). The API 422s a PUT while the order is
// running and rejects unknown fields, so: pause, PUT a clean create payload
// (row values merged with the edits), then play again if it was running.
export const updateAutoOrder = async (uuid: string, edits: Partial<CreateAutoOrder>): Promise<CreateAutoOrder> => {
    // deno-lint-ignore no-explicit-any
    const raw = (((await growinFetch("/autoorder/api/v1"))?.data ?? []) as any[]).find((r) => r.auto_order_uuid === uuid);
    if (!raw) throw new Error(`auto-order ${uuid} not found`);
    const merged = { ...rowToOrder(raw), ...edits };
    const payload = buildCreatePayload(merged);
    payload.orderbook_id = raw.orderbook_id;
    payload.start_from = raw.start_from; // keep the original window start
    payload.auto_order_uuid = uuid;
    const wasRunning = raw.control_state === CONTROL.PLAY;
    if (wasRunning) await controlAutoOrder(uuid, CONTROL.PAUSE);
    await growinFetch("/autoorder/api/v1", { method: "PUT", body: payload });
    if (wasRunning) await controlAutoOrder(uuid, CONTROL.PLAY);
    return merged;
};

// hard delete (permanent cancel)
export const deleteAutoOrder = (uuid: string) =>
    growinFetch(`/autoorder/api/v1/${uuid}`, { method: "DELETE" });
