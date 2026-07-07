// Direct order (instant, media=GW) over the order WebSocket. This is what the
// web app does for a manual buy/sell: a protobuf frame on wss://.../order/ws.
// Unlike auto-order (conditional), this hits the book immediately.
// Wire format reverse-engineered from captured frames (see growin-account-api memory).
import { resolveOrderbookId } from "./growinAutoOrder.ts";
import { growinAuthCookie } from "./growinAccount.ts";
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

export interface OrderAck {
    orderId: number;
    status: string; // "B" buy accepted, "S" sell accepted
    symbol: string;
    lot: number;
    price: number;
    marketOrderId: string; // e.g. GW7982383@M57C3762
}

// ack envelope: f3 { f6 { f2=orderId, f6=status, f7=sym, f9=lot, f10=price, f18=marketId } }
// The server sends a terse ack first, then the detailed one; require marketId
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
    };
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
    const cookie = await growinAuthCookie();
    const w = await wsConnect("/order/ws", cookie);
    const frame = buildOrderFrame({ symbol, side, lot, price, orderbookId });
    try {
        await writeFrame(w.conn, 0x2, frame);
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
            const ack = parseAck(fr.payload);
            if (ack) return ack;
        }
        throw new Error("no ack from order ws (order may or may not have been placed; check `deno task account`)");
    } finally {
        try {
            w.conn.close();
        } catch { /* already closed */ }
    }
};
