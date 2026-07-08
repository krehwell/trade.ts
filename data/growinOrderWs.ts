// Direct order (instant, media=GW) over the order WebSocket. This is what the
// web app does for a manual buy/sell: a protobuf frame on wss://.../order/ws.
// Unlike auto-order (conditional), this hits the book immediately.
// Wire format reverse-engineered from captured frames (see growin-account-api memory).
import { resolveOrderbookId } from "./growinAutoOrder.ts";
import { growinAuthCookie, growinFetch } from "../net/growinFetch.ts";
import { readFrame, writeFrame, wsConnect } from "../net/growinWs.ts";
import { fstr, get, len, parse, str, vint } from "../util/protobuf.ts";

// Constants observed identical across all captured orders (buy + sells), so they
// don't need to be unique per order. side: BUY omits f2 (protobuf enum default 0),
// SELL sets f2=1.
const TOKEN = "q";
const CLIENT_REF = 123456;
const BOARD = "RG";

export interface DirectOrder {
    symbol: string;
    side: "BUY" | "SELL";
    lot: number;
    price: number;
    orderbookId: number;
}

export const buildOrderFrame = (o: DirectOrder): Uint8Array => {
    const order: number[] = [];
    if (o.side === "SELL") vint(2, 1, order);
    str(3, TOKEN, order);
    vint(5, o.lot, order);
    vint(6, o.orderbookId, order);
    vint(7, o.price, order);
    vint(9, CLIENT_REF, order);
    str(11, o.symbol.toUpperCase(), order);
    str(12, BOARD, order);
    vint(13, 3, order);
    vint(14, 1, order);
    const sub: number[] = [];
    len(1, order, sub); // envelope.f2.f1 = order
    const env: number[] = [];
    len(1, [], env); // envelope.f1 = "" (empty)
    len(2, sub, env); // envelope.f2 = wrapper
    return new Uint8Array(env);
};

// Amend / withdraw target a resting order. The action is chosen by which field
// number carries the payload inside the f2 wrapper: f1=place, f2=amend, f3=withdraw.
// envelope.f1 carries { f1: marketOrderId } (which order). internalId + sequence
// come from that order's place confirmation (see OrderAck).
export interface OrderRef {
    marketOrderId: string; // GW...@...
    internalId: number; // from place confirmation
    sequence: number; // from place confirmation
}

const refEnvelope = (ref: OrderRef, wrapperField: number, inner: number[]): Uint8Array => {
    const wrapper: number[] = [];
    len(wrapperField, inner, wrapper);
    const idRef: number[] = [];
    str(1, ref.marketOrderId, idRef);
    const env: number[] = [];
    len(1, idRef, env); // envelope.f1 = { f1: marketOrderId }
    len(2, wrapper, env); // envelope.f2 = { f<field>: inner }
    return new Uint8Array(env);
};

export const buildWithdrawFrame = (ref: OrderRef): Uint8Array => {
    const inner: number[] = [];
    vint(1, ref.internalId, inner);
    vint(2, 3, inner); // action = withdraw
    vint(3, ref.sequence, inner);
    return refEnvelope(ref, 3, inner);
};

export const buildAmendFrame = (ref: OrderRef, newPrice: number): Uint8Array => {
    const inner: number[] = [];
    vint(1, ref.internalId, inner);
    vint(2, 2, inner); // action = amend
    vint(3, newPrice, inner);
    vint(4, 3, inner); // constant observed in captures
    vint(5, ref.sequence, inner);
    return refEnvelope(ref, 2, inner);
};

export interface OrderAck {
    orderId: number;
    status: string; // "B" buy accepted, "S" sell accepted
    symbol: string;
    lot: number;
    price: number;
    marketOrderId: string; // e.g. GW7982383@M57C3762
    internalId: number; // from confirmation frame; needed to amend/withdraw later
    sequence: number; // from confirmation frame; needed to amend/withdraw later
}

// ack envelope: f3 { f6 { f2=orderId, f6=status, f7=sym, f9=lot, f10=price, f18=marketId } }
// The server sends a terse ack first, then the detailed one, so require marketId
// (f18) so we return the complete confirmation, not the partial.
const parseAck = (payload: Uint8Array): OrderAck | null => {
    const resp = get(parse(payload), 3)?.s;
    if (!resp) return null;
    const o = get(parse(resp), 6)?.s;
    if (!o) return null;
    const f = parse(o);
    const status = fstr(get(f, 6)?.s);
    if (status !== "B" && status !== "S") return null;
    const marketOrderId = fstr(get(f, 18)?.s);
    if (!marketOrderId) return null;
    return {
        orderId: get(f, 2)?.v ?? 0,
        status,
        symbol: fstr(get(f, 7)?.s),
        lot: get(f, 9)?.v ?? 0,
        price: get(f, 10)?.v ?? 0,
        marketOrderId,
        internalId: 0,
        sequence: 0,
    };
};

// confirmation envelope: f3 { f1 { f2=internalId, f13=sequence } }. Arrives after
// the ack, and carries the two ids needed to amend/withdraw this order later.
const parseConf = (payload: Uint8Array): { internalId: number; sequence: number } | null => {
    const resp = get(parse(payload), 3)?.s;
    if (!resp) return null;
    const o = get(parse(resp), 1)?.s;
    if (!o) return null;
    const f = parse(o);
    const internalId = get(f, 2)?.v ?? 0;
    if (!internalId) return null;
    return { internalId, sequence: get(f, 13)?.v ?? 0 };
};

// Send one order-action frame, collect the ack. For place, also wait for the
// confirmation frame (internalId + sequence) so the order can be amended/withdrawn
// later. Amend/withdraw don't emit one, so they return on the ack.
const sendAction = async (frame: Uint8Array, needConf: boolean, timeoutMs = 8000): Promise<OrderAck> => {
    const w = await wsConnect("/order/ws", await growinAuthCookie());
    try {
        await writeFrame(w.conn, 0x2, frame);
        let ack: OrderAck | null = null;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<null>((res) => {
                timer = setTimeout(() => res(null), deadline - Date.now());
            });
            const fr = await Promise.race([readFrame(w), timeout]);
            clearTimeout(timer);
            if (!fr) break;
            if (fr.op === 0x9) {
                await writeFrame(w.conn, 0xA, fr.payload);
                continue;
            }
            if (fr.op === 0x8) break;
            if (fr.op !== 0x2 && fr.op !== 0x0) continue;
            ack ??= parseAck(fr.payload);
            const conf = parseConf(fr.payload);
            if (ack && conf) {
                ack.internalId = conf.internalId;
                ack.sequence = conf.sequence;
            }
            if (ack && (!needConf || ack.internalId)) return ack;
        }
        if (ack) return ack; // action accepted; conf may not have arrived
        throw new Error("no ack from order ws (action may or may not have applied; check `deno task account`)");
    } finally {
        try {
            w.conn.close();
        } catch { /* already closed */ }
    }
};

export const placeDirectOrder = async (
    { symbol, side, lot, price, timeoutMs = 8000 }: {
        symbol: string;
        side: "BUY" | "SELL";
        lot: number;
        price: number;
        timeoutMs?: number;
    },
): Promise<OrderAck> => {
    const orderbookId = await resolveOrderbookId(symbol);
    return sendAction(buildOrderFrame({ symbol, side, lot, price, orderbookId }), true, timeoutMs);
};

// The place ack carries internalId + sequence, but the order-list REST also has
// them under other names: internalId = user_order_id, sequence = market_order_id.
// So any resting order can be amended/withdrawn, even one placed in the app.
export const resolveOrderRef = async (marketOrderId: string): Promise<OrderRef> => {
    const j = await growinFetch("/order/api/v2/protected/order-list?page=1");
    const o = (j?.data ?? []).find((x: Record<string, unknown>) => x.market_client_order_id === marketOrderId);
    if (!o) throw new Error(`order ${marketOrderId} not found in order-list`);
    return { marketOrderId, internalId: Number(o.user_order_id), sequence: o.market_order_id as number };
};

export const withdrawDirectOrder = (ref: OrderRef): Promise<OrderAck> =>
    sendAction(buildWithdrawFrame(ref), false);

export const amendDirectOrder = (ref: OrderRef, newPrice: number): Promise<OrderAck> =>
    sendAction(buildAmendFrame(ref, newPrice), false);
